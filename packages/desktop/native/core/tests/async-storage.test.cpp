#include "fake-system.h"
#include "ngn/core-modules.h"

#include <doctest/doctest.h>
#include <folly/json.h>

#include <filesystem>

using folly::dynamic;

namespace {

struct TempDir {
  std::filesystem::path path = std::filesystem::temp_directory_path() /
      ("ngn-kv-" + std::to_string(reinterpret_cast<uintptr_t>(this)));
  TempDir() {
    std::filesystem::remove_all(path);
  }
  ~TempDir() {
    std::filesystem::remove_all(path);
  }
};

} // namespace

TEST_CASE("the key-value store persists to its file, and a new store reads it back") {
  TempDir dir;
  {
    ngn::KeyValueStore store(dir.path.string());
    CHECK(store.set("db", {{"a", "1"}, {"b", "2"}}));
    CHECK(store.remove("db", {"b"}));
    CHECK(store.set("other", {{"x", "y"}}));
  }
  ngn::KeyValueStore again(dir.path.string());
  CHECK(again.get("db", {"a", "b"}) == std::vector<std::optional<std::string>>{"1", std::nullopt});
  CHECK(again.keys("other") == std::vector<std::string>{"x"});
  CHECK(again.clear("db"));
  CHECK(ngn::KeyValueStore(dir.path.string()).keys("db").empty());
  // A database name cannot reach outside the directory.
  CHECK(again.set("../escape", {{"k", "v"}}));
  CHECK_FALSE(std::filesystem::exists(dir.path.parent_path() / "escape.json"));
}

TEST_CASE("merge combines JSON objects recursively and replaces anything else") {
  TempDir dir;
  ngn::KeyValueStore store(dir.path.string());
  store.set("db", {{"user", R"({"name":"Ada","prefs":{"theme":"dark","size":1}})"}, {"count", "1"}});
  store.merge("db", {{"user", R"({"prefs":{"size":2},"age":36})"}, {"count", "2"}, {"new", R"({"a":1})"}});
  auto values = store.get("db", {"user", "count", "new"});
  CHECK(folly::parseJson(*values[0]) ==
        folly::parseJson(R"({"name":"Ada","prefs":{"theme":"dark","size":2},"age":36})"));
  CHECK(values[1] == "2");
  CHECK(values[2] == R"({"a":1})");
}

TEST_CASE("RNCAsyncStorage (2.x) and RNAsyncStorage's legacy calls (3.x) share one database") {
  TempDir dir;
  auto system = std::make_shared<ngn::testing::FakeSystem>();
  ngn::CoreModuleServices services{.system = system, .storage = std::make_shared<ngn::KeyValueStore>(dir.path.string())};
  auto v2 = ngn::makeLegacyAsyncStorage(services);
  dynamic answer;
  auto record = [&](dynamic a) { answer = a; };
  v2->callWithCallbacks("multiSet", dynamic::array(dynamic::array(dynamic::array("k", "v"), dynamic::array("j", "w")), nullptr), {record});
  CHECK(answer == dynamic::array());
  v2->callWithCallbacks("multiGet", dynamic::array(dynamic::array("k", "missing"), nullptr), {record});
  CHECK(answer == dynamic::array(nullptr, dynamic::array(dynamic::array("k", "v"), dynamic::array("missing", nullptr))));
  v2->callWithCallbacks("multiRemove", dynamic::array(dynamic::array("j"), nullptr), {record});
  v2->callWithCallbacks("getAllKeys", dynamic::array(nullptr), {record});
  CHECK(answer == dynamic::array(nullptr, dynamic::array("k")));

  auto v3 = ngn::makeAsyncStorage(services);
  dynamic resolved;
  ngn::JsPromise promise{[&](dynamic v) { resolved = v; }, nullptr};
  v3->callWithPromise("legacy_multiGet", dynamic::array(dynamic::array("k")), promise);
  CHECK(resolved == dynamic::array(dynamic::array("k", "v")));

  v3->callWithPromise("setValues", dynamic::array("notes", dynamic::array(dynamic::object("key", "a")("value", "1"))), promise);
  v3->callWithPromise("getValues", dynamic::array("notes", dynamic::array("a", "k")), promise);
  CHECK(resolved == dynamic::array(dynamic::object("key", "a")("value", "1"), dynamic::object("key", "k")("value", nullptr)));
  v3->callWithPromise("getKeys", dynamic::array("notes"), promise);
  CHECK(resolved == dynamic::array("a"));
  v3->callWithPromise("clearStorage", dynamic::array("notes"), promise);
  v3->callWithPromise("getKeys", dynamic::array("notes"), promise);
  CHECK(resolved == dynamic::array());

  v2->callWithCallbacks("clear", dynamic::array(nullptr), {record});
  v3->callWithPromise("legacy_getAllKeys", dynamic::array(), promise);
  CHECK(resolved == dynamic::array());
}
