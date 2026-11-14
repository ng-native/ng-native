#import "updates.h"

#import <CommonCrypto/CommonDigest.h>
#import <Foundation/Foundation.h>
#import <Security/Security.h>

#include "ngn/bytes.h"

namespace ngn::appkit {

namespace {

class AppleUpdateCrypto final : public UpdateCrypto {
 public:
  std::string sha256(const std::string &bytes) override {
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(bytes.data(), static_cast<CC_LONG>(bytes.size()), digest);
    return std::string(reinterpret_cast<const char *>(digest), sizeof(digest));
  }

  bool verifyRsaSha256(const std::string &certificatePem, const std::string &data, const std::string &signature) override {
    auto der = derOf(certificatePem);
    if (!der) {
      return false;
    }
    NSData *derData = [NSData dataWithBytes:der->data() length:der->size()];
    SecCertificateRef certificate = SecCertificateCreateWithData(nullptr, (__bridge CFDataRef)derData);
    if (certificate == nullptr) {
      return false;
    }
    SecKeyRef key = SecCertificateCopyKey(certificate);
    CFRelease(certificate);
    if (key == nullptr) {
      return false;
    }
    NSData *message = [NSData dataWithBytes:data.data() length:data.size()];
    NSData *sig = [NSData dataWithBytes:signature.data() length:signature.size()];
    bool valid = SecKeyVerifySignature(
        key, kSecKeyAlgorithmRSASignatureMessagePKCS1v15SHA256, (__bridge CFDataRef)message, (__bridge CFDataRef)sig,
        nullptr);
    CFRelease(key);
    return valid;
  }

 private:
  // The certificate's DER: the base64 between the PEM's BEGIN and END lines.
  static std::optional<std::string> derOf(const std::string &pem) {
    const std::string begin = "-----BEGIN CERTIFICATE-----";
    const std::string end = "-----END CERTIFICATE-----";
    auto from = pem.find(begin);
    auto to = pem.find(end);
    if (from == std::string::npos || to == std::string::npos || to < from) {
      return std::nullopt;
    }
    std::string body;
    for (char c : pem.substr(from + begin.size(), to - from - begin.size())) {
      if (!isspace(static_cast<unsigned char>(c))) {
        body += c;
      }
    }
    return base64Decode(body);
  }
};

std::string setting(NSDictionary *info, NSString *key, const char *env) {
  if (NSString *value = info[key]; [value isKindOfClass:NSString.class]) {
    return value.UTF8String;
  }
  if (const char *value = getenv(env)) {
    return value;
  }
  return "";
}

} // namespace

std::shared_ptr<UpdateCrypto> makeUpdateCrypto() {
  return std::make_shared<AppleUpdateCrypto>();
}

UpdatesConfig updatesConfig(const std::string &appData, const std::string &embeddedBundle) {
  NSDictionary *info = NSBundle.mainBundle.infoDictionary;
  UpdatesConfig config{
      .url = setting(info, @"NGNUpdatesURL", "NGN_UPDATES_URL"),
      .runtimeVersion = setting(info, @"NGNRuntimeVersion", "NGN_RUNTIME_VERSION"),
      .certificatePem = setting(info, @"NGNUpdatesCodeSigningCertificate", "NGN_UPDATES_CODE_SIGNING_CERTIFICATE"),
      .directory = std::filesystem::path(appData) / "updates",
      .embeddedBundle = embeddedBundle,
  };
  if (auto platform = setting(info, @"NGNUpdatesPlatform", "NGN_UPDATES_PLATFORM"); !platform.empty()) {
    config.platform = platform;
  }
  if (auto keyId = setting(info, @"NGNUpdatesCodeSigningKeyId", "NGN_UPDATES_CODE_SIGNING_KEY_ID"); !keyId.empty()) {
    config.keyId = keyId;
  }
  if (auto alg = setting(info, @"NGNUpdatesCodeSigningAlg", "NGN_UPDATES_CODE_SIGNING_ALG"); !alg.empty()) {
    config.algorithm = alg;
  }
  // A server needs a runtime version to match against; without one, updates are off.
  if (config.runtimeVersion.empty()) {
    config.url.clear();
  }
  return config;
}

} // namespace ngn::appkit
