#include "ngn/battery.h"

#include <doctest/doctest.h>

#include <optional>

using folly::dynamic;

namespace {

struct FakePower final : ngn::PowerSource {
  ngn::PowerFacts now;
  std::function<void()> changed;
  int stops{0};
  ngn::PowerFacts facts() override {
    return now;
  }
  std::function<void()> watch(std::function<void()> listener) override {
    changed = std::move(listener);
    return [this] { stops++; };
  }
};

dynamic ask(const ngn::NativeModule &module, const std::string &method) {
  std::optional<dynamic> answer;
  module.callWithPromise(method, dynamic::array(), {.resolve = [&](dynamic v) { answer = v; }, .reject = {}});
  REQUIRE(answer);
  return *answer;
}

ngn::PowerFacts laptop(double level, bool charging = false, bool external = false) {
  return {.hasBattery = true, .level = level, .charging = charging, .externalPower = external};
}

} // namespace

TEST_CASE("NgNativeBattery answers -1 and UNKNOWN on a Mac with no battery") {
  auto power = std::make_shared<FakePower>();
  power->now = {.hasBattery = false, .externalPower = true};
  auto module = ngn::makeBatteryModule(power);
  CHECK(ask(*module, "getBatteryLevelAsync") == dynamic(-1.0));
  CHECK(ask(*module, "getBatteryStateAsync") == dynamic(0));
  CHECK(ask(*module, "isAvailableAsync") == dynamic(false));
}

TEST_CASE("NgNativeBattery's state follows the battery and the adapter") {
  CHECK(ngn::batteryStateOf(laptop(0.5)) == 1);
  CHECK(ngn::batteryStateOf(laptop(0.5, true, true)) == 2);
  CHECK(ngn::batteryStateOf(laptop(1, false, true)) == 3);
  auto charged = laptop(0.97, false, true);
  charged.charged = true;
  CHECK(ngn::batteryStateOf(charged) == 3);
  // On the adapter and held at 80% by optimised charging.
  CHECK(ngn::batteryStateOf(laptop(0.8, false, true)) == 4);
  CHECK(ngn::batteryLevelOf(laptop(1.2)) == 1);
}

TEST_CASE("NgNativeBattery answers the level, state and Low Power Mode") {
  auto power = std::make_shared<FakePower>();
  power->now = laptop(0.42, true, true);
  power->now.lowPowerMode = true;
  auto module = ngn::makeBatteryModule(power);
  CHECK(ask(*module, "getBatteryLevelAsync") == dynamic(0.42));
  CHECK(ask(*module, "getBatteryStateAsync") == dynamic(2));
  CHECK(ask(*module, "isLowPowerModeEnabledAsync") == dynamic(true));
  CHECK(ask(*module, "isAvailableAsync") == dynamic(true));
}

TEST_CASE("NgNativeBattery sends what changed, and nothing when nothing did") {
  auto power = std::make_shared<FakePower>();
  power->now = laptop(0.5);
  auto module = ngn::makeBatteryModule(power);
  std::vector<dynamic> events;
  module->setEmitter([&](const std::string &name, dynamic body) {
    CHECK(name == "ngNativeBattery");
    events.push_back(body);
  });
  power->changed();
  CHECK(events.empty());
  power->now = laptop(0.49);
  power->changed();
  power->now = laptop(0.49, true, true);
  power->now.lowPowerMode = true;
  power->changed();
  CHECK(events == std::vector<dynamic>{
                      dynamic::object("type", "level")("batteryLevel", 0.49),
                      dynamic::object("type", "state")("batteryState", 2),
                      dynamic::object("type", "lowPowerMode")("lowPowerMode", true),
                  });
  module.reset();
  CHECK(power->stops == 1);
}
