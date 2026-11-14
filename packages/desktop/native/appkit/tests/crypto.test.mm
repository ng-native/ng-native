// AppleCrypto (crypto.mm) against the published test vectors: RFC 1319, 1320 and 1321 for MD2, MD4
// and MD5, and FIPS 180's "abc" for the SHA family.
#include "../crypto.h"

#include <doctest/doctest.h>

#include <set>

TEST_CASE("AppleCrypto digests match the published test vectors") {
  auto crypto = ngn::appkit::makeCryptoSource();
  auto hex = [&](const char *algorithm, const std::string &bytes) { return ngn::hexOf(*crypto->digest(algorithm, bytes)); };
  CHECK(hex("MD2", "abc") == "da853b0d3f88d99b30283a69e6ded6bb");
  CHECK(hex("MD4", "abc") == "a448017aaf21d8525fc10ae87aa6729d");
  CHECK(hex("MD5", "abc") == "900150983cd24fb0d6963f7d28e17f72");
  CHECK(hex("SHA-1", "abc") == "a9993e364706816aba3e25717850c26c9cd0d89d");
  CHECK(hex("SHA-256", "abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  CHECK(hex("SHA-384", "abc") ==
        "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7");
  CHECK(hex("SHA-512", "abc") ==
        "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd"
        "454d4423643ce80e2a9ac94fa54ca49f");
  CHECK_FALSE(crypto->digest("SHA-3", "abc"));
}

TEST_CASE("AppleCrypto's random bytes are the length asked for, and differ") {
  auto crypto = ngn::appkit::makeCryptoSource();
  CHECK(crypto->randomBytes(0).empty());
  std::set<std::string> drawn;
  for (int i = 0; i < 8; i++) {
    auto bytes = crypto->randomBytes(32);
    CHECK(bytes.size() == 32);
    drawn.insert(bytes);
  }
  CHECK(drawn.size() == 8);
  auto module = ngn::makeCryptoModule(crypto);
  CHECK(module->call("randomUUID") != module->call("randomUUID"));
}
