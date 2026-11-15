#include "ngn/location.h"

#include <mutex>
#include <set>
#include <stdexcept>

namespace ngn {

namespace {

using Authorization = LocationSource::Authorization;

const char *const kNotAuthorized = "Not authorized to use location services";

folly::dynamic permissionOf(Authorization authorization) {
  const char *status = authorization == Authorization::Granted         ? "granted"
      : authorization == Authorization::NotDetermined                  ? "undetermined"
                                                                       : "denied";
  return folly::dynamic::object("status", status)("granted", authorization == Authorization::Granted)(
      "canAskAgain", authorization == Authorization::NotDetermined)("expires", "never");
}

folly::dynamic orNull(const std::optional<double> &value) {
  return value ? folly::dynamic(*value) : folly::dynamic(nullptr);
}

folly::dynamic locationOf(const LocationSource::Fix &fix) {
  return folly::dynamic::object(
      "coords",
      folly::dynamic::object("latitude", fix.latitude)("longitude", fix.longitude)("altitude", orNull(fix.altitude))(
          "accuracy", orNull(fix.accuracy))("altitudeAccuracy", orNull(fix.altitudeAccuracy))("heading", orNull(fix.heading))(
          "speed", orNull(fix.speed)))("timestamp", fix.timestamp);
}

// expo-location's Accuracy (1 lowest to 6 navigation) as metres, the way its iOS module maps it
// onto CLLocationAccuracy.
double metresOf(const folly::dynamic &options) {
  const auto *accuracy = options.isObject() ? options.get_ptr("accuracy") : nullptr;
  int level = accuracy != nullptr && accuracy->isNumber() ? static_cast<int>(accuracy->asDouble()) : 3;
  switch (level) {
    case 1: return 3000;
    case 2: return 1000;
    case 3: return 100;
    case 4: return 10;
    default: return 0;
  }
}

const char *const kExpoAddressFields[] = {
    "city", "district", "streetNumber", "street", "region", "subregion",
    "country", "postalCode", "name", "isoCountryCode", "timezone"};

// Answers a geocoder's places through `shape`, or the rejection expo-location's iOS module gives.
void settle(const Geocoder::Answer &answer, JsPromise &p, folly::dynamic (*shape)(const Geocoder::Place &)) {
  switch (answer.failure) {
    case Geocoder::Failure::Network: p.reject("Geocoding rate limit exceeded - too many requests"); return;
    case Geocoder::Failure::Failed:
      p.reject("Error while geocoding a location" + (answer.reason.empty() ? "" : ": " + answer.reason));
      return;
    case Geocoder::Failure::NoResult: p.resolve(folly::dynamic::array()); return;
    case Geocoder::Failure::None: break;
  }
  folly::dynamic places = folly::dynamic::array();
  for (const auto &place : answer.places) {
    places.push_back(shape(place));
  }
  p.resolve(std::move(places));
}

folly::dynamic pointOf(const Geocoder::Place &place) {
  return folly::dynamic::object("latitude", orNull(place.latitude))("longitude", orNull(place.longitude))(
      "altitude", orNull(place.altitude))("accuracy", orNull(place.accuracy));
}

folly::dynamic addressOf(const Geocoder::Place &place) {
  folly::dynamic address = folly::dynamic::object();
  for (const char *field : kExpoAddressFields) {
    auto found = place.address.find(field);
    address[field] = found == place.address.end() ? folly::dynamic(nullptr) : folly::dynamic(found->second);
  }
  return address;
}

} // namespace

std::shared_ptr<NativeModule> makeLocationModule(std::shared_ptr<LocationSource> source, bool noPrompts, std::shared_ptr<Geocoder> geocoder) {
  // The watches still running, stopped when the module goes with its runtime.
  struct Watches {
    std::mutex mutex;
    std::set<int> handles;
  };
  struct Location : NativeModule {
    std::shared_ptr<LocationSource> source;
    std::shared_ptr<Watches> watches = std::make_shared<Watches>();

    Location(std::shared_ptr<LocationSource> from, bool noPrompts, std::shared_ptr<Geocoder> geocoder)
        : NativeModule("NgNativeLocation"), source(std::move(from)) {
      auto source = this->source;
      if (geocoder) {
        promise("geocodeAsync", [geocoder](const folly::dynamic &args, JsPromise p) {
          if (args.empty() || !args[0].isString()) {
            p.reject("Address to geocode must be a string");
            return;
          }
          geocoder->geocode(args[0].asString(), [p](Geocoder::Answer answer) mutable { settle(answer, p, pointOf); });
        });
        promise("reverseGeocodeAsync", [geocoder](const folly::dynamic &args, JsPromise p) {
          const auto *latitude = !args.empty() && args[0].isObject() ? args[0].get_ptr("latitude") : nullptr;
          const auto *longitude = !args.empty() && args[0].isObject() ? args[0].get_ptr("longitude") : nullptr;
          if (!latitude || !longitude || !latitude->isNumber() || !longitude->isNumber()) {
            p.reject("Location to reverse-geocode must be an object with number properties `latitude` and `longitude`");
            return;
          }
          geocoder->reverseGeocode(latitude->asDouble(), longitude->asDouble(), [p](Geocoder::Answer answer) mutable {
            settle(answer, p, addressOf);
          });
        });
      }
      promise("getForegroundPermissionsAsync", [source](const folly::dynamic &, JsPromise p) {
        p.resolve(permissionOf(source->authorization()));
      });
      promise("requestForegroundPermissionsAsync", [source, noPrompts](const folly::dynamic &, JsPromise p) {
        auto now = source->authorization();
        if (noPrompts || now != Authorization::NotDetermined) {
          p.resolve(permissionOf(now));
          return;
        }
        source->requestAuthorization([p](Authorization decided) { p.resolve(permissionOf(decided)); });
      });
      promise("getCurrentPositionAsync", [source](const folly::dynamic &args, JsPromise p) {
        if (source->authorization() != Authorization::Granted) {
          p.reject(kNotAuthorized);
          return;
        }
        source->currentFix(metresOf(args.empty() ? nullptr : args[0]), [p](std::optional<LocationSource::Fix> fix, std::string error) {
          if (fix) {
            p.resolve(locationOf(*fix));
          } else {
            p.reject(error.empty() ? "The location is not available" : error);
          }
        });
      });
      auto watches = this->watches;
      subscription("watchPositionAsync", [source, watches](const folly::dynamic &args, JsCallback callback) -> std::function<void()> {
        if (source->authorization() != Authorization::Granted) {
          throw std::runtime_error(kNotAuthorized);
        }
        const auto options = args.empty() ? folly::dynamic(nullptr) : args[0];
        const auto *distance = options.isObject() ? options.get_ptr("distanceInterval") : nullptr;
        int handle = source->watch(metresOf(options), distance != nullptr && distance->isNumber() ? distance->asDouble() : 0,
                                   [callback](const LocationSource::Fix &fix) {
                                     if (callback) {
                                       callback(folly::dynamic::array(locationOf(fix)));
                                     }
                                   });
        {
          std::lock_guard lock(watches->mutex);
          watches->handles.insert(handle);
        }
        return [source, watches, handle] {
          {
            std::lock_guard lock(watches->mutex);
            if (watches->handles.erase(handle) == 0) {
              return;
            }
          }
          source->stopWatching(handle);
        };
      });
    }

    ~Location() override {
      std::set<int> left;
      {
        std::lock_guard lock(watches->mutex);
        left.swap(watches->handles);
      }
      for (int handle : left) {
        source->stopWatching(handle);
      }
    }
  };
  return std::make_shared<Location>(std::move(source), noPrompts, std::move(geocoder));
}

} // namespace ngn
