#include "fake-system.h"
#include "ngn/core-modules.h"

#include <doctest/doctest.h>
#include <folly/json.h>

using folly::dynamic;
using ngn::testing::FakeSystem;

namespace {

struct Fixture {
  std::shared_ptr<FakeSystem> system = std::make_shared<FakeSystem>();
  std::shared_ptr<ngn::HostState> state = std::make_shared<ngn::HostState>();
  ngn::CoreModuleServices services{.system = system, .state = state, .reactNativeVersion = "0.88.0"};
  std::vector<std::string> events;

  std::shared_ptr<ngn::NativeModule> make() {
    auto module = ngn::makeAccessibilityManager(services);
    module->setEmitter([this](const std::string &event, dynamic body) { events.push_back(event + " " + folly::toJson(body)); });
    return module;
  }
};

// What a getCurrent*State method passes its success callback, or "error" when it calls the other.
std::string ask(const ngn::NativeModule &module, const std::string &method) {
  std::string out = "nothing";
  module.callWithCallbacks(
      method,
      dynamic::array(nullptr, nullptr),
      {[&](dynamic a) { out = folly::toJson(a); }, [&](dynamic) { out = "error"; }});
  return out;
}

} // namespace

TEST_CASE("AccessibilityManager answers each setting as the system has it") {
  Fixture f;
  f.state->accessibility.set({.screenReader = true, .reduceMotion = true, .invertColors = true});
  auto module = f.make();
  CHECK(ask(*module, "getCurrentVoiceOverState") == "[true]");
  CHECK(ask(*module, "getCurrentReduceMotionState") == "[true]");
  CHECK(ask(*module, "getCurrentInvertColorsState") == "[true]");
  CHECK(ask(*module, "getCurrentReduceTransparencyState") == "[false]");
  CHECK(ask(*module, "getCurrentDarkerSystemColorsState") == "[false]");
  CHECK(ask(*module, "getCurrentBoldTextState") == "[false]");
  CHECK(ask(*module, "getCurrentGrayscaleState") == "[false]");
  CHECK(ask(*module, "getCurrentPrefersCrossFadeTransitionsState") == "[false]");

  f.state->accessibility.set({.reduceTransparency = true, .increaseContrast = true});
  CHECK(ask(*module, "getCurrentVoiceOverState") == "[false]");
  CHECK(ask(*module, "getCurrentReduceTransparencyState") == "[true]");
  CHECK(ask(*module, "getCurrentDarkerSystemColorsState") == "[true]");
}

TEST_CASE("AccessibilityManager sends an event for each setting that changed, as iOS names them") {
  Fixture f;
  auto module = f.make();
  f.state->accessibility.set({.screenReader = true});
  CHECK(f.events == std::vector<std::string>{"screenReaderChanged true"});

  f.events.clear();
  f.state->accessibility.set({.screenReader = true, .reduceMotion = true, .reduceTransparency = true});
  CHECK(f.events == std::vector<std::string>{"reduceMotionChanged true", "reduceTransparencyChanged true"});

  f.events.clear();
  f.state->accessibility.set({.invertColors = true, .boldText = true, .increaseContrast = true, .grayscale = true});
  CHECK(f.events == std::vector<std::string>{
                        "screenReaderChanged false",
                        "reduceMotionChanged false",
                        "reduceTransparencyChanged false",
                        "invertColorsChanged true",
                        "boldTextChanged true",
                        "darkerSystemColorsChanged true",
                        "grayscaleChanged true"});

  // A module a reload destroyed hears nothing more.
  f.events.clear();
  module.reset();
  f.state->accessibility.set({});
  CHECK(f.events.empty());
}

TEST_CASE("AccessibilityManager takes the iOS-only calls without doing anything") {
  Fixture f;
  auto module = f.make();
  CHECK_NOTHROW(module->call("setAccessibilityContentSizeMultipliers", dynamic::array(dynamic::object("large", 1.2))));
  CHECK(f.system->log.empty());
}
