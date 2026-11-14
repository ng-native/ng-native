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
// services", and nothing is read.
// - geocodeAsync(address): [{latitude, longitude, altitude, accuracy}], and
//   reverseGeocodeAsync({latitude, longitude}): [{city, district, streetNumber, street, region,
//   subregion, country, postalCode, name, isoCountryCode, timezone}], over a Geocoder, which needs
//   no permission, as on iOS. No match answers []; a network failure or rate limit and any other
//   failure reject with expo-location's iOS messages. Without a geocoder neither method is there.
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

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

class Geocoder {
 public:
  enum class Failure { None, NoResult, Network, Failed };
  struct Place {
    // geocode's: the place's point, and its altitude and accuracy in metres where known.
    std::optional<double> latitude;
    std::optional<double> longitude;
    std::optional<double> altitude;
    std::optional<double> accuracy;
    // reverseGeocode's: expo's address fields the geocoder knows, by expo's names.
    std::map<std::string, std::string> address;
  };
  struct Answer {
    std::vector<Place> places;
    Failure failure{Failure::None};
    // The OS's description of a failure.
    std::string reason;
  };
  virtual ~Geocoder() = default;
  // Each answers once, on any thread.
  virtual void geocode(const std::string &address, std::function<void(Answer)> done) = 0;
  virtual void reverseGeocode(double latitude, double longitude, std::function<void(Answer)> done) = 0;
};

std::shared_ptr<NativeModule> makeLocationModule(
    std::shared_ptr<LocationSource> source,
    bool noPrompts,
    std::shared_ptr<Geocoder> geocoder = nullptr);

} // namespace ngn
