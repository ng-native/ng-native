// AppleUpdateCrypto (updates.mm) against a real certificate and signature (update-signing.h).
#include "../updates.h"

#include "update-signing.h"

#include <doctest/doctest.h>

using namespace ngn::testing::update_signing;

TEST_CASE("AppleUpdateCrypto verifies an RSA SHA-256 signature by a real certificate, and nothing else") {
  auto crypto = ngn::appkit::makeUpdateCrypto();
  CHECK(crypto->verifyRsaSha256(kCertificate, kManifest, signature()));

  auto tamperedManifest = kManifest;
  tamperedManifest.replace(tamperedManifest.find("1.0.0"), 5, "2.0.0");
  CHECK_FALSE(crypto->verifyRsaSha256(kCertificate, tamperedManifest, signature()));
  auto tamperedSignature = signature();
  tamperedSignature[10] = static_cast<char>(tamperedSignature[10] ^ 1);
  CHECK_FALSE(crypto->verifyRsaSha256(kCertificate, kManifest, tamperedSignature));
  CHECK_FALSE(crypto->verifyRsaSha256(kOtherCertificate, kManifest, signature()));
  CHECK_FALSE(crypto->verifyRsaSha256("not a certificate", kManifest, signature()));
  CHECK_FALSE(crypto->verifyRsaSha256("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----", kManifest, signature()));
  CHECK_FALSE(crypto->verifyRsaSha256(kCertificate, kManifest, ""));
}

TEST_CASE("AppleUpdateCrypto's SHA-256 is the standard one") {
  auto crypto = ngn::appkit::makeUpdateCrypto();
  // FIPS 180-2's "abc" vector, as the protocol's base64url hash.
  CHECK(ngn::base64Url(crypto->sha256("abc")) == "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  CHECK(ngn::base64Url(crypto->sha256("")) == "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
}
