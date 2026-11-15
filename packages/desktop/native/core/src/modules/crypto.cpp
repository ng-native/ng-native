#include "ngn/crypto.h"

#include "ngn/bytes.h"

#include <stdexcept>

namespace ngn {

namespace {

// expo-crypto's own limit on getRandomBytes.
constexpr size_t kMaxRandomBytes = 1024;

const folly::dynamic &arg(const folly::dynamic &args, size_t at) {
  static const folly::dynamic none = nullptr;
  return args.isArray() && args.size() > at ? args[at] : none;
}

std::string algorithmOf(const folly::dynamic &args, const char *method) {
  const auto &algorithm = arg(args, 0);
  if (!algorithm.isString()) {
    throw std::invalid_argument(std::string("Crypto.") + method + ": the algorithm must be a string");
  }
  return algorithm.asString();
}

std::string digestOf(CryptoSource &source, const std::string &algorithm, const std::string &bytes) {
  auto digest = source.digest(algorithm, bytes);
  if (!digest) {
    throw std::invalid_argument("Crypto: " + algorithm + " is not a supported digest algorithm");
  }
  return *digest;
}

} // namespace

std::string hexOf(const std::string &bytes) {
  static const char *const kHex = "0123456789abcdef";
  std::string out;
  out.reserve(bytes.size() * 2);
  for (unsigned char byte : bytes) {
    out += kHex[byte >> 4];
    out += kHex[byte & 15];
  }
  return out;
}

std::string uuidV4(std::string bytes) {
  if (bytes.size() != 16) {
    throw std::invalid_argument("a UUID takes 16 bytes");
  }
  bytes[6] = static_cast<char>((bytes[6] & 0x0f) | 0x40);
  bytes[8] = static_cast<char>((bytes[8] & 0x3f) | 0x80);
  auto hex = hexOf(bytes);
  return hex.substr(0, 8) + "-" + hex.substr(8, 4) + "-" + hex.substr(12, 4) + "-" + hex.substr(16, 4) + "-" +
      hex.substr(20);
}

std::shared_ptr<NativeModule> makeCryptoModule(std::shared_ptr<CryptoSource> source) {
  struct Crypto : NativeModule {
    explicit Crypto(std::shared_ptr<CryptoSource> source) : NativeModule("NgNativeCrypto") {
      sync("randomUUID", [source](const folly::dynamic &) { return folly::dynamic(uuidV4(source->randomBytes(16))); });
      sync("getRandomBytes", [source](const folly::dynamic &args) {
        const auto &count = arg(args, 0);
        if (!count.isNumber() || count.asDouble() < 0 || count.asDouble() > kMaxRandomBytes ||
            count.asDouble() != static_cast<double>(static_cast<size_t>(count.asDouble()))) {
          throw std::invalid_argument("Crypto.getRandomBytes: the byte count must be a whole number from 0 to 1024");
        }
        auto n = static_cast<size_t>(count.asDouble());
        return folly::dynamic::object("base64", base64Encode(n == 0 ? std::string() : source->randomBytes(n)));
      });
      promise("digestStringAsync", [source](const folly::dynamic &args, JsPromise promise) {
        try {
          auto algorithm = algorithmOf(args, "digestStringAsync");
          const auto &text = arg(args, 1);
          if (!text.isString()) {
            throw std::invalid_argument("Crypto.digestStringAsync: the data must be a string");
          }
          const auto &options = arg(args, 2);
          std::string encoding = "hex";
          if (options.isObject()) {
            const auto *given = options.get_ptr("encoding");
            if (given != nullptr && given->isString()) {
              encoding = given->asString();
            }
          }
          if (encoding != "hex" && encoding != "base64") {
            throw std::invalid_argument("Crypto.digestStringAsync: the encoding must be hex or base64, not " + encoding);
          }
          auto digest = digestOf(*source, algorithm, text.asString());
          promise.resolve(encoding == "hex" ? hexOf(digest) : base64Encode(digest));
        } catch (const std::exception &error) {
          promise.reject(error.what());
        }
      });
      promise("digestAsync", [source](const folly::dynamic &args, JsPromise promise) {
        try {
          auto algorithm = algorithmOf(args, "digest");
          const auto &data = arg(args, 1);
          const auto *base64 = data.isObject() ? data.get_ptr("base64") : nullptr;
          auto bytes = base64 != nullptr && base64->isString() ? base64Decode(base64->asString()) : std::nullopt;
          if (!bytes) {
            throw std::invalid_argument("Crypto.digest: the data must be bytes");
          }
          promise.resolve(folly::dynamic::object("base64", base64Encode(digestOf(*source, algorithm, *bytes))));
        } catch (const std::exception &error) {
          promise.reject(error.what());
        }
      });
    }
  };
  return std::make_shared<Crypto>(std::move(source));
}

} // namespace ngn
