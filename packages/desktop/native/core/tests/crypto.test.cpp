#include "ngn/bytes.h"
#include "ngn/crypto.h"

#include <doctest/doctest.h>

#include <optional>

using folly::dynamic;

namespace {

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

Answer ask(const ngn::NativeModule &module, const std::string &method, dynamic args) {
  Answer answer;
  module.callWithPromise(
      method, args,
      {.resolve = [&](dynamic v) { answer.value = v; }, .reject = [&](const std::string &e) { answer.error = e; }});
  return answer;
}

// Knows SHA-256 only, whose "digest" is the input reversed; random bytes count up from `next`.
struct FakeCrypto final : ngn::CryptoSource {
  std::vector<std::pair<std::string, std::string>> digested;
  std::vector<size_t> drawn;
  unsigned char next{0xff};
  std::optional<std::string> digest(const std::string &algorithm, const std::string &bytes) override {
    digested.emplace_back(algorithm, bytes);
    if (algorithm != "SHA-256") {
      return std::nullopt;
    }
    return std::string(bytes.rbegin(), bytes.rend());
  }
  std::string randomBytes(size_t count) override {
    drawn.push_back(count);
    std::string out;
    for (size_t i = 0; i < count; i++) {
      out += static_cast<char>(next);
    }
    return out;
  }
};

} // namespace

TEST_CASE("NgNativeCrypto's randomUUID is a version 4 UUID from 16 random bytes") {
  auto source = std::make_shared<FakeCrypto>();
  auto module = ngn::makeCryptoModule(source);
  // All bits set: only the version and variant bits are cleared.
  CHECK(module->call("randomUUID") == dynamic("ffffffff-ffff-4fff-bfff-ffffffffffff"));
  source->next = 0;
  CHECK(module->call("randomUUID") == dynamic("00000000-0000-4000-8000-000000000000"));
  CHECK(source->drawn == std::vector<size_t>{16, 16});
}

TEST_CASE("NgNativeCrypto's getRandomBytes takes 0 to 1024 and answers {base64}") {
  auto source = std::make_shared<FakeCrypto>();
  source->next = 1;
  auto module = ngn::makeCryptoModule(source);
  CHECK(module->call("getRandomBytes", dynamic::array(3)) == dynamic::object("base64", "AQEB"));
  CHECK(module->call("getRandomBytes", dynamic::array(0)) == dynamic::object("base64", ""));
  CHECK(module->call("getRandomBytes", dynamic::array(1024))["base64"].asString().size() == 1368);
  CHECK_THROWS(module->call("getRandomBytes", dynamic::array(1025)));
  CHECK_THROWS(module->call("getRandomBytes", dynamic::array(-1)));
  CHECK_THROWS(module->call("getRandomBytes", dynamic::array(1.5)));
  CHECK_THROWS(module->call("getRandomBytes", dynamic::array("3")));
  // Nothing drawn for the empty and refused calls.
  CHECK(source->drawn == std::vector<size_t>{3, 1024});
}

TEST_CASE("NgNativeCrypto digests a string as hex unless asked for base64") {
  auto source = std::make_shared<FakeCrypto>();
  auto module = ngn::makeCryptoModule(source);
  CHECK(ask(*module, "digestStringAsync", dynamic::array("SHA-256", "ab")).value == dynamic("6261"));
  CHECK(ask(*module, "digestStringAsync", dynamic::array("SHA-256", "ab", dynamic::object("encoding", "hex"))).value ==
        dynamic("6261"));
  CHECK(ask(*module, "digestStringAsync", dynamic::array("SHA-256", "ab", dynamic::object("encoding", "base64"))).value ==
        dynamic("YmE="));
  CHECK(ask(*module, "digestStringAsync", dynamic::array("SHA-256", "ab", dynamic::object("encoding", "utf8"))).error);
  CHECK(ask(*module, "digestStringAsync", dynamic::array("SHA-256", 4)).error);
}

TEST_CASE("NgNativeCrypto refuses an algorithm the source does not know") {
  auto module = ngn::makeCryptoModule(std::make_shared<FakeCrypto>());
  auto refused = ask(*module, "digestStringAsync", dynamic::array("SHA-3", "ab"));
  REQUIRE(refused.error);
  CHECK(refused.error->find("SHA-3") != std::string::npos);
  CHECK(ask(*module, "digestAsync", dynamic::array("SHA-3", dynamic::object("base64", "AQ=="))).error);
  CHECK(ask(*module, "digestStringAsync", dynamic::array(nullptr, "ab")).error);
}

TEST_CASE("NgNativeCrypto digests bytes that cross as {base64}") {
  auto source = std::make_shared<FakeCrypto>();
  auto module = ngn::makeCryptoModule(source);
  auto answer = ask(*module, "digestAsync", dynamic::array("SHA-256", dynamic::object("base64", "AQID")));
  CHECK(answer.value == dynamic(dynamic::object("base64", "AwIB")));
  CHECK(source->digested.back().second == std::string("\x01\x02\x03", 3));
  CHECK(ask(*module, "digestAsync", dynamic::array("SHA-256", "AQID")).error);
  CHECK(ask(*module, "digestAsync", dynamic::array("SHA-256", dynamic::object("base64", "!!"))).error);
}
