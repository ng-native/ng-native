#include "crypto.h"

#import <CommonCrypto/CommonDigest.h>
#import <Security/Security.h>

#include <algorithm>
#include <limits>
#include <stdexcept>

// MD2 and MD4 are deprecated in CommonCrypto, and expo-crypto still offers them.
#pragma clang diagnostic ignored "-Wdeprecated-declarations"

namespace ngn::appkit {

namespace {

// Fed in chunks that fit CC_LONG, which is 32 bits: a longer length would wrap.
template <size_t Length, typename Context>
std::string digestWith(int (*init)(Context *), int (*update)(Context *, const void *, CC_LONG),
                       int (*final)(unsigned char *, Context *), const std::string &bytes, size_t chunk) {
  Context context;
  init(&context);
  for (size_t at = 0; at < bytes.size(); at += chunk) {
    update(&context, bytes.data() + at, static_cast<CC_LONG>(std::min(chunk, bytes.size() - at)));
  }
  unsigned char out[Length];
  final(out, &context);
  return std::string(reinterpret_cast<const char *>(out), Length);
}

class AppleCrypto final : public CryptoSource {
 public:
  std::optional<std::string> digest(const std::string &algorithm, const std::string &bytes) override {
    return digestInChunks(algorithm, bytes, size_t{1} << 30);
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

std::optional<std::string> digestInChunks(const std::string &algorithm, const std::string &bytes, size_t chunk) {
  chunk = std::clamp<size_t>(chunk, 1, std::numeric_limits<CC_LONG>::max());
  if (algorithm == "SHA-1") {
    return digestWith<CC_SHA1_DIGEST_LENGTH>(CC_SHA1_Init, CC_SHA1_Update, CC_SHA1_Final, bytes, chunk);
  }
  if (algorithm == "SHA-256") {
    return digestWith<CC_SHA256_DIGEST_LENGTH>(CC_SHA256_Init, CC_SHA256_Update, CC_SHA256_Final, bytes, chunk);
  }
  if (algorithm == "SHA-384") {
    return digestWith<CC_SHA384_DIGEST_LENGTH>(CC_SHA384_Init, CC_SHA384_Update, CC_SHA384_Final, bytes, chunk);
  }
  if (algorithm == "SHA-512") {
    return digestWith<CC_SHA512_DIGEST_LENGTH>(CC_SHA512_Init, CC_SHA512_Update, CC_SHA512_Final, bytes, chunk);
  }
  if (algorithm == "MD2") {
    return digestWith<CC_MD2_DIGEST_LENGTH>(CC_MD2_Init, CC_MD2_Update, CC_MD2_Final, bytes, chunk);
  }
  if (algorithm == "MD4") {
    return digestWith<CC_MD4_DIGEST_LENGTH>(CC_MD4_Init, CC_MD4_Update, CC_MD4_Final, bytes, chunk);
  }
  if (algorithm == "MD5") {
    return digestWith<CC_MD5_DIGEST_LENGTH>(CC_MD5_Init, CC_MD5_Update, CC_MD5_Final, bytes, chunk);
  }
  return std::nullopt;
}

std::shared_ptr<CryptoSource> makeCryptoSource() {
  return std::make_shared<AppleCrypto>();
}

} // namespace ngn::appkit
