// The policy a backend's System keeps over its OS calls (system.h): the colour scheme an override
// leaves behind, and preferences over a string store.
#include "ngn/system.h"

#include <doctest/doctest.h>
#include <folly/json.h>

#include <map>

namespace {

struct MemoryStore final : ngn::StringStore {
  std::map<std::string, std::string> values;
  std::optional<std::string> get(const std::string &key) override {
    auto it = values.find(key);
    return it != values.end() ? std::optional(it->second) : std::nullopt;
  }
  void set(const std::string &key, const std::string &value) override {
    values[key] = value;
  }
  void remove(const std::string &key) override {
    values.erase(key);
  }
};

} // namespace

TEST_CASE("the colour scheme is the app's override while one holds, and the system's again once cleared") {
  ngn::ColorSchemeOverride scheme("light");
  CHECK(scheme.current() == "light");
  scheme.set("dark");
  CHECK(scheme.current() == "dark");
  // The system changing under an override is not followed until the override goes.
  scheme.systemChanged("dark");
  scheme.set("light");
  CHECK(scheme.current() == "light");
  scheme.set(std::nullopt);
  CHECK(scheme.current() == "dark");
}

TEST_CASE("a colour scheme change tells the scheme it applied, not a later change's override") {
  ngn::ColorSchemeOverride scheme("light");
  // Clearing, then an override queued behind it: the clearing applied the system's scheme.
  scheme.set(std::nullopt);
  scheme.set("dark");
  CHECK(scheme.applied(std::nullopt) == "light");
  CHECK(scheme.applied("dark") == "dark");
  scheme.systemChanged("dark");
  CHECK(scheme.applied(std::nullopt) == "dark");
}

TEST_CASE("preferences are kept as JSON, and setting nothing removes one") {
  auto store = std::make_shared<MemoryStore>();
  ngn::JsonPreferences preferences(store, "dev.ngnative.app", false);
  CHECK_FALSE(preferences.get("frame"));
  preferences.set("frame", folly::dynamic::object("width", 800)("height", 600));
  REQUIRE(store->values.contains("frame"));
  CHECK(folly::parseJson(store->values["frame"]) == folly::dynamic::object("width", 800)("height", 600));
  CHECK(*preferences.get("frame") == folly::dynamic::object("width", 800)("height", 600));
  preferences.set("frame", std::nullopt);
  CHECK(store->values.empty());
  CHECK_FALSE(preferences.get("frame"));
}

TEST_CASE("a store shared with other apps keeps each app's preferences under its id") {
  auto store = std::make_shared<MemoryStore>();
  ngn::JsonPreferences one(store, "dev.ngnative.one", true);
  ngn::JsonPreferences two(store, "dev.ngnative.two", true);
  one.set("theme", folly::dynamic("dark"));
  two.set("theme", folly::dynamic("light"));
  CHECK(store->values ==
        std::map<std::string, std::string>{{"dev.ngnative.one.theme", R"("dark")"}, {"dev.ngnative.two.theme", R"("light")"}});
  CHECK(*one.get("theme") == "dark");
  CHECK(*two.get("theme") == "light");
  one.set("theme", std::nullopt);
  CHECK(store->values == std::map<std::string, std::string>{{"dev.ngnative.two.theme", R"("light")"}});
}

TEST_CASE("a stored preference that is not JSON reads as nothing") {
  auto store = std::make_shared<MemoryStore>();
  store->values["broken"] = "{not json";
  ngn::JsonPreferences preferences(store, "dev.ngnative.app", false);
  CHECK_FALSE(preferences.get("broken"));
}
