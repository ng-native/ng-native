#include "ngn/network-state.h"

#include <doctest/doctest.h>

#include <optional>

using folly::dynamic;

namespace {

struct FakeMonitor final : ngn::PathMonitor {
  std::function<void(const ngn::NetworkPath &)> changed;
  int stops{0};
  std::function<void()> watch(std::function<void(const ngn::NetworkPath &)> listener) override {
    changed = std::move(listener);
    return [this] { stops++; };
  }
};

std::optional<dynamic> state(const ngn::NativeModule &module) {
  std::optional<dynamic> answer;
  module.callWithPromise("getNetworkStateAsync", dynamic::array(), {.resolve = [&](dynamic v) { answer = v; }, .reject = {}});
  return answer;
}

dynamic expected(const char *type, bool connected) {
  return dynamic::object("type", type)("isConnected", connected)("isInternetReachable", connected);
}

} // namespace

TEST_CASE("NgNativeNetwork names the interface a satisfied path uses, as expo-network does") {
  CHECK(ngn::networkStateOf({.satisfied = true, .wifi = true, .other = true}) == expected("WIFI", true));
  CHECK(ngn::networkStateOf({.satisfied = true, .ethernet = true}) == expected("ETHERNET", true));
  CHECK(ngn::networkStateOf({.satisfied = true, .cellular = true}) == expected("CELLULAR", true));
  CHECK(ngn::networkStateOf({.satisfied = true, .other = true}) == expected("OTHER", true));
  CHECK(ngn::networkStateOf({.satisfied = true}) == expected("UNKNOWN", true));
  CHECK(ngn::networkStateOf({.satisfied = false, .wifi = true}) == expected("NONE", false));
}

TEST_CASE("NgNativeNetwork answers the state once the first path is known") {
  auto monitor = std::make_shared<FakeMonitor>();
  auto module = ngn::makeNetworkModule(monitor);
  std::vector<dynamic> events;
  module->setEmitter([&](const std::string &name, dynamic body) {
    CHECK(name == "ngNativeNetwork");
    events.push_back(body);
  });
  std::optional<dynamic> early;
  module->callWithPromise("getNetworkStateAsync", dynamic::array(), {.resolve = [&](dynamic v) { early = v; }, .reject = {}});
  CHECK_FALSE(early);
  monitor->changed({.satisfied = true, .wifi = true});
  CHECK(early == expected("WIFI", true));
  CHECK(state(*module) == expected("WIFI", true));
  // The first path is the state, not a change.
  CHECK(events.empty());
}

TEST_CASE("NgNativeNetwork sends a change, and only a change") {
  auto monitor = std::make_shared<FakeMonitor>();
  auto module = ngn::makeNetworkModule(monitor);
  std::vector<dynamic> events;
  module->setEmitter([&](const std::string &, dynamic body) { events.push_back(body); });
  monitor->changed({.satisfied = true, .wifi = true});
  monitor->changed({.satisfied = true, .wifi = true});
  monitor->changed({.satisfied = false});
  monitor->changed({.satisfied = true, .ethernet = true});
  CHECK(events == std::vector<dynamic>{expected("NONE", false), expected("ETHERNET", true)});
  CHECK(state(*module) == expected("ETHERNET", true));
}

TEST_CASE("NgNativeNetwork stops watching when it goes with its runtime") {
  auto monitor = std::make_shared<FakeMonitor>();
  ngn::makeNetworkModule(monitor).reset();
  CHECK(monitor->stops == 1);
}
