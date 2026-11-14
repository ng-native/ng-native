// NgNativeLocation: the slice of expo-location that @ng-native/expo's Location calls, over a
// LocationSource, which the AppKit backend implements with CLLocationManager.
//
// - getForegroundPermissionsAsync and requestForegroundPermissionsAsync: {status: granted |
//   denied | undetermined, granted, canAskAgain, expires: 'never'}. Restricted reads as denied.
//   Only an undetermined authorization is asked for; with `noPrompts` (NGN_NO_PROMPTS=1 in the
//   host's environment) nothing is, and the request answers what is decided.
// - getCurrentPositionAsync({accuracy}): {coords: {latitude, longitude, altitude, accuracy,
//   altitudeAccuracy, heading, speed}, timestamp}, as expo-location's LocationObject.
// - watchPositionAsync({accuracy, distanceInterval}, callback): a promise of {remove()}, the
//   callback taking each fix.
// Without the permission both refuse with expo-location's "Not authorized to use location
// services", and nothing is read. Geocoding is not answered: the service gives no places.
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <memory>
#include <optional>
#include <string>

namespace ngn {

class LocationSource {
 public:
  enum class Authorization { NotDetermined, Denied, Restricted, Granted };

  struct Fix {
    double latitude{0};
    double longitude{0};
    // Nothing where the Mac does not know.
    std::optional<double> altitude;
    std::optional<double> accuracy;
    std::optional<double> altitudeAccuracy;
    std::optional<double> heading;
    std::optional<double> speed;
    // Milliseconds since 1970.
    double timestamp{0};
  };

  virtual ~LocationSource() = default;
  virtual Authorization authorization() = 0;
  // Shows the OS's prompt, and answers once the user has decided. Any thread.
  virtual void requestAuthorization(std::function<void(Authorization)> done) = 0;
  // One fix at about `accuracy` metres, or why there is none. Any thread.
  virtual void currentFix(double accuracy, std::function<void(std::optional<Fix>, std::string error)> done) = 0;
  // Each fix after moving `distance` metres, until stopWatching. A handle.
  virtual int watch(double accuracy, double distance, std::function<void(const Fix &)> fix) = 0;
  virtual void stopWatching(int handle) = 0;
};

std::shared_ptr<NativeModule> makeLocationModule(std::shared_ptr<LocationSource> source, bool noPrompts);

} // namespace ngn
