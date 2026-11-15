#include "ngn/splash-screen.h"

#include <doctest/doctest.h>

#include <optional>
#include <vector>

using folly::dynamic;

namespace {

dynamic ask(const ngn::NativeModule &module, const std::string &method) {
  std::optional<dynamic> answer;
  module.callWithPromise(method, dynamic::array(), {.resolve = [&](dynamic v) { answer = v; }, .reject = {}});
  REQUIRE(answer);
  return *answer;
}

} // namespace

TEST_CASE("The splash holds the first windows until it is hidden, then shows them in order") {
  auto gate = std::make_shared<ngn::SplashGate>();
  auto module = ngn::makeSplashScreenModule(gate);
  std::vector<int> shown;
  CHECK(ask(*module, "preventAutoHideAsync") == dynamic(true));
  gate->show([&] { shown.push_back(1); });
  gate->show([&] { shown.push_back(2); });
  CHECK(shown.empty());
  CHECK(ask(*module, "hideAsync") == dynamic(nullptr));
  CHECK(shown == std::vector<int>{1, 2});
  // After it is hidden a window shows at once, and hiding again does nothing.
  gate->show([&] { shown.push_back(3); });
  CHECK(shown == std::vector<int>{1, 2, 3});
  module->call("hide");
  CHECK(shown.size() == 3);
}

TEST_CASE("The splash cannot be held once a window has shown, and an unheld one shows at once") {
  auto gate = std::make_shared<ngn::SplashGate>();
  auto module = ngn::makeSplashScreenModule(gate);
  int shown = 0;
  gate->show([&] { shown++; });
  CHECK(shown == 1);
  CHECK(ask(*module, "preventAutoHideAsync") == dynamic(false));
  gate->show([&] { shown++; });
  CHECK(shown == 2);
}

TEST_CASE("A reload, which ends the module, shows the windows its app held") {
  auto gate = std::make_shared<ngn::SplashGate>();
  auto module = ngn::makeSplashScreenModule(gate);
  int shown = 0;
  ask(*module, "preventAutoHideAsync");
  gate->show([&] { shown++; });
  module.reset();
  CHECK(shown == 1);
  CHECK_FALSE(gate->held());
}
