// NgNativeBattery: what @ng-native/expo's Battery calls on expo-battery, over a PowerSource, which
// the AppKit backend implements with IOKit's power sources and NSProcessInfo's Low Power Mode.
//
// - getBatteryLevelAsync(): 0 to 1, or -1 on a Mac with no battery, as expo-battery answers where
//   there is none.
// - getBatteryStateAsync(): expo-battery's BatteryState: 1 UNPLUGGED, 2 CHARGING, 3 FULL, 4
//   NOT_CHARGING (on power and held below full), and 0 UNKNOWN with no battery.
// - isLowPowerModeEnabledAsync(), isAvailableAsync() (whether there is a battery).
// - `ngNativeBattery` on DeviceEventEmitter as each changes: {type: 'level', batteryLevel},
//   {type: 'state', batteryState} or {type: 'lowPowerMode', lowPowerMode}.
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <memory>

namespace ngn {

struct PowerFacts {
  bool hasBattery{false};
  // 0 to 1.
  double level{0};
  bool charging{false};
  // The battery reports itself charged.
  bool charged{false};
  // Running on the power adapter.
  bool externalPower{false};
  bool lowPowerMode{false};
  bool operator==(const PowerFacts &) const = default;
};

class PowerSource {
 public:
  virtual ~PowerSource() = default;
  virtual PowerFacts facts() = 0;
  // Calls `changed` when anything about the power may have changed, on any thread, until the
  // answer is called.
  virtual std::function<void()> watch(std::function<void()> changed) = 0;
};

// expo-battery's level and BatteryState for the facts.
double batteryLevelOf(const PowerFacts &facts);
int batteryStateOf(const PowerFacts &facts);

std::shared_ptr<NativeModule> makeBatteryModule(std::shared_ptr<PowerSource> source);

} // namespace ngn
