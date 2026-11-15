#include "ngn/screen-capture.h"

#include <doctest/doctest.h>

#include <optional>
#include <vector>

using folly::dynamic;

namespace {

struct FakeShield final : ngn::CaptureShield {
  std::vector<bool> changes;
  void setProtected(bool on) override {
    changes.push_back(on);
  }
};

dynamic ask(const ngn::NativeModule &module, const std::string &method, dynamic args = dynamic::array()) {
  std::optional<dynamic> answer;
  module.callWithPromise(method, args, {.resolve = [&](dynamic v) { answer = v; }, .reject = {}});
  REQUIRE(answer);
  return *answer;
}

} // namespace

TEST_CASE("NgNativeScreenCapture keeps capture prevented while any key is held") {
  auto shield = std::make_shared<FakeShield>();
  auto module = ngn::makeScreenCaptureModule(shield);
  CHECK(ask(*module, "isAvailableAsync") == dynamic(true));
  ask(*module, "preventScreenCaptureAsync", dynamic::array("card"));
  ask(*module, "preventScreenCaptureAsync", dynamic::array(nullptr));
  // A key already held changes nothing.
  ask(*module, "preventScreenCaptureAsync", dynamic::array("card"));
  CHECK(shield->changes == std::vector<bool>{true});
  ask(*module, "allowScreenCaptureAsync", dynamic::array("card"));
  CHECK(shield->changes == std::vector<bool>{true});
  // No key is expo-screen-capture's `default`.
  ask(*module, "allowScreenCaptureAsync", dynamic::array("default"));
  CHECK(shield->changes == std::vector<bool>{true, false});
  // A key not held changes nothing.
  ask(*module, "allowScreenCaptureAsync", dynamic::array("other"));
  CHECK(shield->changes == std::vector<bool>{true, false});
}

TEST_CASE("NgNativeScreenCapture lets capture back when a reload ends the module holding keys") {
  auto shield = std::make_shared<FakeShield>();
  auto module = ngn::makeScreenCaptureModule(shield);
  ask(*module, "preventScreenCaptureAsync", dynamic::array("card"));
  module.reset();
  CHECK(shield->changes == std::vector<bool>{true, false});
  auto idle = ngn::makeScreenCaptureModule(shield);
  idle.reset();
  CHECK(shield->changes == std::vector<bool>{true, false});
}

TEST_CASE("NgNativeScreenCapture answers granted, and has no app switcher snapshot to hide") {
  auto shield = std::make_shared<FakeShield>();
  auto module = ngn::makeScreenCaptureModule(shield);
  auto permission = ask(*module, "requestPermissionsAsync");
  CHECK(permission["status"] == dynamic("granted"));
  CHECK(permission["granted"] == dynamic(true));
  CHECK(ask(*module, "getPermissionsAsync")["granted"] == dynamic(true));
  CHECK(ask(*module, "enableAppSwitcherProtectionAsync", dynamic::array(0.5)) == dynamic(nullptr));
  CHECK(ask(*module, "disableAppSwitcherProtectionAsync") == dynamic(nullptr));
  CHECK(shield->changes.empty());
  auto none = ngn::makeScreenCaptureModule(nullptr);
  CHECK(ask(*none, "isAvailableAsync") == dynamic(false));
  ask(*none, "preventScreenCaptureAsync", dynamic::array("card"));
}
