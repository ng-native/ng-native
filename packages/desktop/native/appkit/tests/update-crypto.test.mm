// AppleUpdateCrypto (updates.mm) against a real certificate: a self-signed RSA 2048 one made with
// openssl for this test, and an update manifest signed by its key with `openssl dgst -sha256 -sign`,
// as an Expo Updates server signs one. The key itself is not kept.
#include "../updates.h"

#include "ngn/bytes.h"

#include <doctest/doctest.h>

namespace {

const std::string kCertificate = R"(-----BEGIN CERTIFICATE-----
MIIC9jCCAd6gAwIBAgIUD2d17Duiu6GbaxubGyIxWY7PNaMwDQYJKoZIhvcNAQEL
BQAwGjEYMBYGA1UEAwwPbmduIHVwZGF0ZSB0ZXN0MCAXDTI2MTExNDA4MTc1MloY
DzIxMjYxMDIxMDgxNzUyWjAaMRgwFgYDVQQDDA9uZ24gdXBkYXRlIHRlc3QwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC8/lEbpJDOIIbNZc5Oqg00HreU
7lwo/IKmE52BsveDaTyRCLABhg8l7rmNUGMiLIO004EiGeuHWpnEOGYYQsS06UM1
H6Es6mgPOpqWvsD6bHHMCPoHDLw00oyJk+QUHTJRUzUscadZi6/foCL4/OeWJ8Ts
gHiejyfZuF+PerVkB9hVYYjsuWDSGcJBmmr2mILoH6k0G90aIBnsAQIQgNSg76Pm
JlicRrkWViocxMUjM0zPdnuEuNYv+Z3vaONt5DH3bd6zI/nQcs8hRUKHQ5DmX052
bHqlqI+qFS251pMjgwmAIzjY8Yf2zlbgLoy1MK80i+AqWOW4G+EFgSZUaQuZAgMB
AAGjMjAwMB0GA1UdDgQWBBSNZAMoomcP9xg44JJ/E29OO8TgtDAPBgNVHRMBAf8E
BTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBdowuG+cplNAmMPONcM0mZ7inIdLp9
eyDRppACyIXS5DM2J3DsWDMvzOH3ndpwuHUenGFSoU7g7d2AKfKcFMWHcw4vK0mL
FJNqeOMTMdB5V9vD+sNyUCBb66aIkk6pjGP5X+ubV81GEVmifr7FmGuo2G9TjX0/
RLWtw1uR3WM6P7rpU71FMuo/LN1+530VWzitFBWakDaUprs1BowT6Cf20oJZtmNt
Ehi4eJe1o/Wd+9Dt95U4FxYhoVzjbYqU1kTEeYk67p0IGKMDh1uZpAi7rVoiMam0
phCYfEsCNTzWJjVi3VQo32+xFSEd9v7lVsqJ7PurSdJNR0ynEaJgbdQp
-----END CERTIFICATE-----
)";

const std::string kOtherCertificate = R"(-----BEGIN CERTIFICATE-----
MIIC6jCCAdKgAwIBAgIUXvVJkLIoT/JXzPoy71Nk+EutIScwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbmduIG90aGVyMCAXDTI2MTExNDA4MTc1MloYDzIxMjYx
MDIxMDgxNzUyWjAUMRIwEAYDVQQDDAluZ24gb3RoZXIwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQCfskCmsPRooShlp4Yu6n2XlIyERw0TXSRz0+SqOC6Y
MrJtV5S6y+Wd7d93hQQcYG2mAn/M+d6iI+B3JRogmU463UWUAhP77BO7msIHJjuX
15lZe1j4Njzskpz+6wFL+YvzOtVwFD9osAQV5UnhrR6MaR2/9Y4OLNZ6Cg1TBjwf
XK5iFrMYfHrpQ0HDvYNhJSD/Fp02OC+wOzPScRY4snuw3wvdXDtTE1exZLsRNxez
JcXahaF6vc0WSsSK5CJ9vBMILdxe8Z5VRvV8y8EBzUuK5XcsQqeEZ9XHDdfyijW7
xfz8hFk8WVNrainM9PpF55F8f1/LheCSqHy5y9XLG3QNAgMBAAGjMjAwMB0GA1Ud
DgQWBBRR80RAfvMD278YaN9bGfuDWYH8JDAPBgNVHRMBAf8EBTADAQH/MA0GCSqG
SIb3DQEBCwUAA4IBAQA6geC+7tOfosHbERi2FMf575Hm2FNrhgsuBg1dKZjwEqcw
rMgS/HpSmwioJfoYJ3VsiPs4UJhbOS66jKgTVbNFx0w+kX+LXvSxXYwziBVAGkCz
ugc2CK147iIEkIe0M32v2NYuAeYVqV84xXeyNnb2pWPoc6SMUSnnSJ7lkuhxy5MW
578OZyajV21DHZgJhqEdgoO0EebqqI7c94kVb2j5vKFndO/kPumtf6fzV9CQ7K65
ip5dL+tMamfekhSVdsz2gId0s6/cysLi0oLfWXVYlJe6zZvH4mrZz0n1zMQfygG5
WCTGW3OuXs9z529nowVPx/RgK5sXgIk1lfMQo9pR
-----END CERTIFICATE-----
)";

const std::string kManifest = R"({"id":"2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d","runtimeVersion":"1.0.0"})";

std::string signature() {
  return *ngn::base64Decode("BOD1SRaie8UbUD+VE75hsAtf9PNg8l/NYp4aKzlGuXcdMaB7P40qWjC/tqtJgrM38P4K0dmg3jPQYUWVIDCbU+fZjT2796lvl1b540xczMaL8sI9mb39lwvHiZND0d5NxsZcanPMrQ7mkXQqiATuiDIVLuYlEdHTcyutaHDk50e+cLbfG8F9Jwex68rt9C6QNeF5+Sq5av8BvTFKxQl3oAO1IEfV3Ydh53wx5vAvWpLst9ma8KU6HN/Iy9VLA3H2zJf1KsZi2sbOJLAdHsxkQKikR+pg9b+69dkvjduNjPqXB/n6vrEaaiy6MIlByrlaw+ZlJuVZym1ZReLjw7wgUA==");
}

} // namespace

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
