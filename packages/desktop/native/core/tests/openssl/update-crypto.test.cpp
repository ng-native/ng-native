// OpenSslUpdateCrypto (openssl-update-crypto.cpp) against a real certificate and signature
// (update-signing.h), as AppleUpdateCrypto's test checks the macOS one.
#include "ngn/openssl-update-crypto.h"

#include "update-signing.h"

#include <doctest/doctest.h>

using namespace ngn::testing::update_signing;

namespace {

// A P-256 certificate, and its key's ECDSA SHA-256 signature of kManifest: a real signature, by a
// key that is not RSA.
const std::string kEcCertificate = R"(-----BEGIN CERTIFICATE-----
MIIBhDCCASmgAwIBAgIUR3TBWOWK7X7zfptO+v2ol/qGF5EwCgYIKoZIzj0EAwIw
FjEUMBIGA1UEAwwLbmduIGVjIHRlc3QwIBcNMjYxMTE5MTA0NzI5WhgPMjEyNjEw
MjYxMDQ3MjlaMBYxFDASBgNVBAMMC25nbiBlYyB0ZXN0MFkwEwYHKoZIzj0CAQYI
KoZIzj0DAQcDQgAEl/VVDa3KdN0byd9Gp+JBdDXY4p67ipExc6wtED96F2sSbIlG
0dELMo0MDxd/wRRnlbAIuZyuSbLD4VFBXrEoR6NTMFEwHQYDVR0OBBYEFEHFTVL5
tu27PZXr6rg9cq91VIw8MB8GA1UdIwQYMBaAFEHFTVL5tu27PZXr6rg9cq91VIw8
MA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSQAwRgIhAJ3/W0pEoXyvMDhg
8KCX7OMLb8yDD9f/a0D+t4A03D0dAiEA0LbJnbBaG3Eu7yQ61wkzrq2veFUwIs67
bRkO621chF4=
-----END CERTIFICATE-----
)";

std::string ecSignature() {
  return *ngn::base64Decode("MEUCIQCEHlPgP8g3umKkob/zXA2TDHdke7ENs8wS/cMO+4aXYgIgZ5uqqEqs7Lmow7H3eQVHcryN3jnYHZennK8oGypbaOU=");
}

} // namespace

TEST_CASE("OpenSslUpdateCrypto verifies an RSA SHA-256 signature by a real certificate, and nothing else") {
  auto crypto = ngn::makeOpenSslUpdateCrypto();
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
  // The algorithm is RSASSA-PKCS1-v1_5: an ECDSA signature that is valid for its own key is not one.
  CHECK_FALSE(crypto->verifyRsaSha256(kEcCertificate, kManifest, ecSignature()));
  // A failed check leaves nothing behind that fails the next.
  CHECK(crypto->verifyRsaSha256(kCertificate, kManifest, signature()));
}

TEST_CASE("OpenSslUpdateCrypto's SHA-256 is the standard one") {
  auto crypto = ngn::makeOpenSslUpdateCrypto();
  // FIPS 180-2's "abc" vector, as the protocol's base64url hash.
  CHECK(ngn::base64Url(crypto->sha256("abc")) == "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  CHECK(ngn::base64Url(crypto->sha256("")) == "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
}
