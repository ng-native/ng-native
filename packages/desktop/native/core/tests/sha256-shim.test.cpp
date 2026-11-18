// shim/openssl/sha.h: the SHA-256 React Native's dev-server helper hashes the device id with,
// against FIPS 180-4's examples, fed whole and a byte at a time.
#include <doctest/doctest.h>
#include <openssl/sha.h>

#include <algorithm>
#include <string>
#include <utility>

namespace {

std::string hex(const unsigned char *digest) {
  static const char digits[] = "0123456789abcdef";
  std::string out;
  for (int i = 0; i < SHA256_DIGEST_LENGTH; i++) {
    out += digits[digest[i] >> 4];
    out += digits[digest[i] & 0xf];
  }
  return out;
}

std::string sha256(const std::string &message, size_t chunk) {
  SHA256_CTX context;
  SHA256_Init(&context);
  for (size_t at = 0; at < message.size(); at += chunk) {
    SHA256_Update(&context, message.data() + at, std::min(chunk, message.size() - at));
  }
  unsigned char digest[SHA256_DIGEST_LENGTH];
  SHA256_Final(digest, &context);
  return hex(digest);
}

} // namespace

TEST_CASE("the SHA-256 shim hashes FIPS 180-4's examples") {
  const std::pair<std::string, std::string> examples[] = {
      {"", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},
      {"abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"},
      // 56 bytes: the length no longer fits the last block, so padding takes another.
      {"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
       "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"},
      {std::string(1000000, 'a'), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"},
      // Exactly one block of message.
      {std::string(64, 'a'), "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb"},
  };
  for (const auto &[message, digest] : examples) {
    CAPTURE(message.size());
    CHECK(sha256(message, message.size() + 1) == digest);
    CHECK(sha256(message, 1) == digest);
    CHECK(sha256(message, 63) == digest);
  }
}
