#include "ngn/battery.h"

#include <algorithm>
#include <cmath>
#include <mutex>

namespace ngn {

namespace {

// expo-battery's BatteryState.
enum BatteryState { Unknown = 0, Unplugged = 1, Charging = 2, Full = 3, NotCharging = 4 };

} // namespace

double batteryLevelOf(const PowerFacts &facts) {
  if (!facts.hasBattery) {
    return -1;
  }
  return std::clamp(facts.level, 0.0, 1.0);
}

int batteryStateOf(const PowerFacts &facts) {
  if (!facts.hasBattery) {
    return Unknown;
  }
  if (facts.charging) {
    return Charging;
  }
  if (!facts.externalPower) {
    return Unplugged;
  }
  return facts.charged || facts.level >= 1 ? Full : NotCharging;
}

std::shared_ptr<NativeModule> makeBatteryModule(std::shared_ptr<PowerSource> source) {
  struct Battery : NativeModule {
    std::shared_ptr<PowerSource> source;
    std::mutex mutex;
    PowerFacts last;
    std::function<void()> stop;

    explicit Battery(std::shared_ptr<PowerSource> from) : NativeModule("NgNativeBattery"), source(std::move(from)) {
      listeners();
      auto power = source;
      promise("getBatteryLevelAsync", [power](const folly::dynamic &, JsPromise promise) {
        promise.resolve(batteryLevelOf(power->facts()));
      });
      promise("getBatteryStateAsync", [power](const folly::dynamic &, JsPromise promise) {
        promise.resolve(batteryStateOf(power->facts()));
      });
      promise("isLowPowerModeEnabledAsync", [power](const folly::dynamic &, JsPromise promise) {
        promise.resolve(power->facts().lowPowerMode);
      });
      promise("isAvailableAsync", [power](const folly::dynamic &, JsPromise promise) {
        promise.resolve(power->facts().hasBattery);
      });
      last = source->facts();
      stop = source->watch([this] { changed(); });
    }

    ~Battery() override {
      if (stop) {
        stop();
      }
    }

    void changed() {
      auto now = source->facts();
      PowerFacts before;
      {
        std::lock_guard lock(mutex);
        before = last;
        last = now;
      }
      if (batteryLevelOf(now) != batteryLevelOf(before)) {
        emit("ngNativeBattery", folly::dynamic::object("type", "level")("batteryLevel", batteryLevelOf(now)));
      }
      if (batteryStateOf(now) != batteryStateOf(before)) {
        emit("ngNativeBattery", folly::dynamic::object("type", "state")("batteryState", batteryStateOf(now)));
      }
      if (now.lowPowerMode != before.lowPowerMode) {
        emit("ngNativeBattery", folly::dynamic::object("type", "lowPowerMode")("lowPowerMode", now.lowPowerMode));
      }
    }
  };
  return std::make_shared<Battery>(std::move(source));
}

} // namespace ngn
