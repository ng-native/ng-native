#include "crypto.h"

#import <CommonCrypto/CommonDigest.h>
#import <Security/Security.h>

#include <stdexcept>

// MD2 and MD4 are deprecated in CommonCrypto, and expo-crypto still offers them.
#pragma clang diagnostic ignored "-Wdeprecated-declarations"

namespace ngn::appkit {

namespace {

template <size_t Length>
std::string digestWith(unsigned char *(*fn)(const void *, CC_LONG, unsigned char *), const std::string &bytes) {
  unsigned char out[Length];
  fn(bytes.data(), static_cast<CC_LONG>(bytes.size()), out);
  return std::string(reinterpret_cast<const char *>(out), Length);
}

class AppleCrypto final : public CryptoSource {
 public:
  std::optional<std::string> digest(const std::string &algorithm, const std::string &bytes) override {
    if (algorithm == "SHA-1") {
      return digestWith<CC_SHA1_DIGEST_LENGTH>(CC_SHA1, bytes);
    }
    if (algorithm == "SHA-256") {
      return digestWith<CC_SHA256_DIGEST_LENGTH>(CC_SHA256, bytes);
    }
    if (algorithm == "SHA-384") {
      return digestWith<CC_SHA384_DIGEST_LENGTH>(CC_SHA384, bytes);
    }
    if (algorithm == "SHA-512") {
      return digestWith<CC_SHA512_DIGEST_LENGTH>(CC_SHA512, bytes);
    }
    if (algorithm == "MD2") {
      return digestWith<CC_MD2_DIGEST_LENGTH>(CC_MD2, bytes);
    }
    if (algorithm == "MD4") {
      return digestWith<CC_MD4_DIGEST_LENGTH>(CC_MD4, bytes);
    }
    if (algorithm == "MD5") {
      return digestWith<CC_MD5_DIGEST_LENGTH>(CC_MD5, bytes);
    }
    return std::nullopt;
  }

  std::string randomBytes(size_t count) override {
    std::string out(count, '\0');
    if (count > 0 && SecRandomCopyBytes(kSecRandomDefault, count, out.data()) != errSecSuccess) {
      throw std::runtime_error("Crypto: the system's secure random source failed");
    }
    return out;
  }
};

} // namespace

std::shared_ptr<CryptoSource> makeCryptoSource() {
  return std::make_shared<AppleCrypto>();
}

} // namespace ngn::appkit
