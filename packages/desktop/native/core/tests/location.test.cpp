#include "ngn/location.h"

#include <doctest/doctest.h>

#include <map>

using folly::dynamic;
using Authorization = ngn::LocationSource::Authorization;

namespace {

// A Mac whose location the test decides: the authorization, whether asking would change it, and
// the fixes it would give.
struct FakeLocation final : ngn::LocationSource {
  Authorization now{Authorization::NotDetermined};
  std::optional<Authorization> afterAsking;
  int asked{0};
  int fixesAsked{0};
  std::map<int, std::function<void(const Fix &)>> watches;
  int next{0};

  Authorization authorization() override {
    return now;
  }
  void requestAuthorization(std::function<void(Authorization)> done) override {
    asked++;
    if (afterAsking) {
      now = *afterAsking;
    }
    done(now);
  }
  void currentFix(double, std::function<void(std::optional<Fix>, std::string)> done) override {
    fixesAsked++;
    done(Fix{.latitude = 51.5, .longitude = -0.12, .altitude = 11, .accuracy = 35, .timestamp = 1.7e12}, "");
  }
  int watch(double, double, std::function<void(const Fix &)> fix) override {
    watches[++next] = std::move(fix);
    return next;
  }
  void stopWatching(int handle) override {
    watches.erase(handle);
  }
};

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

Answer ask(const ngn::NativeModule &module, const std::string &method, dynamic args = dynamic::array()) {
  Answer answer;
  module.callWithPromise(
      method, args,
      {.resolve = [&](dynamic v) { answer.value = v; }, .reject = [&](const std::string &e) { answer.error = e; }});
  return answer;
}

} // namespace

TEST_CASE("NgNativeLocation answers the foreground permission in expo-location's shape") {
  auto mac = std::make_shared<FakeLocation>();
  auto module = ngn::makeLocationModule(mac, false);
  auto undetermined = ask(*module, "getForegroundPermissionsAsync").value;
  REQUIRE(undetermined);
  CHECK((*undetermined)["status"] == "undetermined");
  CHECK((*undetermined)["granted"] == false);
  CHECK((*undetermined)["canAskAgain"] == true);
  CHECK((*undetermined)["expires"] == "never");
  CHECK(mac->asked == 0);

  // The user says no.
  mac->afterAsking = Authorization::Denied;
  auto denied = ask(*module, "requestForegroundPermissionsAsync").value;
  REQUIRE(denied);
  CHECK(mac->asked == 1);
  CHECK((*denied)["status"] == "denied");
  CHECK((*denied)["canAskAgain"] == false);
  // Restricted by a profile reads as denied too, never to be asked again.
  mac->now = Authorization::Restricted;
  CHECK((*ask(*module, "getForegroundPermissionsAsync").value)["status"] == "denied");
  // Asking again once it is decided shows nothing.
  ask(*module, "requestForegroundPermissionsAsync");
  CHECK(mac->asked == 1);
}

TEST_CASE("NgNativeLocation never prompts with NGN_NO_PROMPTS, and answers what is decided") {
  auto mac = std::make_shared<FakeLocation>();
  mac->afterAsking = Authorization::Granted;
  auto module = ngn::makeLocationModule(mac, true);
  auto answer = ask(*module, "requestForegroundPermissionsAsync").value;
  REQUIRE(answer);
  CHECK(mac->asked == 0);
  CHECK((*answer)["status"] == "undetermined");
}

TEST_CASE("NgNativeLocation reads no position and watches nothing without the permission") {
  auto mac = std::make_shared<FakeLocation>();
  mac->now = Authorization::Denied;
  auto module = ngn::makeLocationModule(mac, false);
  auto fix = ask(*module, "getCurrentPositionAsync", dynamic::array(dynamic::object("accuracy", 3)));
  REQUIRE(fix.error);
  CHECK(fix.error->find("Not authorized") != std::string::npos);
  CHECK(mac->fixesAsked == 0);

  CHECK_THROWS_WITH_AS(module->subscribe("watchPositionAsync", dynamic::array(dynamic::object("accuracy", 3), nullptr),
                                          [](dynamic) {}),
                       doctest::Contains("Not authorized"), std::exception);
  CHECK(mac->watches.empty());
}

TEST_CASE("NgNativeLocation gives a fix and follows the position in expo-location's shape once granted") {
  auto mac = std::make_shared<FakeLocation>();
  mac->now = Authorization::Granted;
  auto module = ngn::makeLocationModule(mac, false);
  auto fix = ask(*module, "getCurrentPositionAsync", dynamic::array(dynamic::object("accuracy", 4))).value;
  REQUIRE(fix);
  CHECK((*fix)["coords"]["latitude"] == 51.5);
  CHECK((*fix)["coords"]["accuracy"] == 35);
  CHECK((*fix)["coords"]["heading"] == nullptr);
  CHECK((*fix)["timestamp"] == 1.7e12);

  std::vector<dynamic> seen;
  auto stop = module->subscribe("watchPositionAsync", dynamic::array(dynamic::object("accuracy", 4)("distanceInterval", 10), nullptr),
                                [&](dynamic args) { seen.push_back(args); });
  REQUIRE(mac->watches.size() == 1);
  mac->watches.begin()->second({.latitude = 1, .longitude = 2, .timestamp = 5});
  REQUIRE(seen.size() == 1);
  CHECK(seen[0][0]["coords"]["longitude"] == 2);
  stop();
  CHECK(mac->watches.empty());
  // Stopping twice, as a remove() called again, does nothing more.
  stop();
}

TEST_CASE("NgNativeLocation stops the watches still running when it goes, as on a reload") {
  auto mac = std::make_shared<FakeLocation>();
  mac->now = Authorization::Granted;
  {
    auto module = ngn::makeLocationModule(mac, false);
    module->subscribe("watchPositionAsync", dynamic::array(dynamic::object(), nullptr), [](dynamic) {});
    CHECK(mac->watches.size() == 1);
  }
  CHECK(mac->watches.empty());
}

namespace {

// A geocoder that answers what the test gives it, and keeps what it was asked.
struct FakeGeocoder final : ngn::Geocoder {
  Answer answer;
  std::vector<std::string> asked;
  void geocode(const std::string &address, std::function<void(Answer)> done) override {
    asked.push_back(address);
    done(answer);
  }
  void reverseGeocode(double latitude, double longitude, std::function<void(Answer)> done) override {
    asked.push_back(std::to_string(latitude).substr(0, 7) + "," + std::to_string(longitude).substr(0, 9));
    done(answer);
  }
};

} // namespace

TEST_CASE("NgNativeLocation geocodes without the permission, in expo-location's iOS shape") {
  auto location = std::make_shared<FakeLocation>();
  location->now = Authorization::Denied;
  auto geocoder = std::make_shared<FakeGeocoder>();
  geocoder->answer.places = {
      {.latitude = 37.3349, .longitude = -122.009, .altitude = 30, .accuracy = 100},
      {.latitude = 37.33, .longitude = -122.0},
  };
  auto module = ngn::makeLocationModule(location, false, geocoder);
  auto found = ask(*module, "geocodeAsync", dynamic::array("1 Apple Park Way, Cupertino"));
  REQUIRE(found.value);
  CHECK(geocoder->asked == std::vector<std::string>{"1 Apple Park Way, Cupertino"});
  CHECK(*found.value == dynamic::array(
      dynamic::object("latitude", 37.3349)("longitude", -122.009)("altitude", 30)("accuracy", 100),
      dynamic::object("latitude", 37.33)("longitude", -122.0)("altitude", nullptr)("accuracy", nullptr)));
  CHECK(location->asked == 0);
}

TEST_CASE("NgNativeLocation reverse geocodes a point into expo's address fields") {
  auto geocoder = std::make_shared<FakeGeocoder>();
  ngn::Geocoder::Place place;
  place.address = {
      {"city", "Cupertino"}, {"street", "Apple Park Way"}, {"streetNumber", "1"}, {"region", "CA"},
      {"country", "United States"}, {"isoCountryCode", "US"}, {"postalCode", "95014"}, {"name", "Apple Park"},
      {"timezone", "America/Los_Angeles"}};
  geocoder->answer.places = {place};
  auto module = ngn::makeLocationModule(std::make_shared<FakeLocation>(), false, geocoder);
  auto found = ask(*module, "reverseGeocodeAsync", dynamic::array(dynamic::object("latitude", 37.3349)("longitude", -122.009)));
  REQUIRE(found.value);
  CHECK(geocoder->asked == std::vector<std::string>{"37.3349,-122.0090"});
  REQUIRE(found.value->size() == 1);
  const auto &address = (*found.value)[0];
  CHECK(address["city"] == dynamic("Cupertino"));
  CHECK(address["streetNumber"] == dynamic("1"));
  CHECK(address["timezone"] == dynamic("America/Los_Angeles"));
  // Every field expo names is there, null where the geocoder has none.
  for (const char *field : {"district", "subregion"}) {
    CHECK(address[field] == dynamic(nullptr));
  }
  CHECK(address.size() == 11);
}

TEST_CASE("NgNativeLocation answers no places as none, and rejects a bad request or a failure as iOS does") {
  auto geocoder = std::make_shared<FakeGeocoder>();
  auto module = ngn::makeLocationModule(std::make_shared<FakeLocation>(), false, geocoder);
  geocoder->answer.failure = ngn::Geocoder::Failure::NoResult;
  CHECK(*ask(*module, "geocodeAsync", dynamic::array("nowhere at all")).value == dynamic::array());
  geocoder->answer.failure = ngn::Geocoder::Failure::Network;
  CHECK(*ask(*module, "geocodeAsync", dynamic::array("a")).error == "Geocoding rate limit exceeded - too many requests");
  geocoder->answer.failure = ngn::Geocoder::Failure::Failed;
  geocoder->answer.reason = "The operation couldn't be completed. (kCLErrorDomain error 8.)";
  CHECK(*ask(*module, "reverseGeocodeAsync", dynamic::array(dynamic::object("latitude", 1)("longitude", 2))).error ==
        "Error while geocoding a location: The operation couldn't be completed. (kCLErrorDomain error 8.)");

  geocoder->asked.clear();
  CHECK(*ask(*module, "geocodeAsync", dynamic::array(5)).error == "Address to geocode must be a string");
  CHECK(*ask(*module, "reverseGeocodeAsync", dynamic::array(dynamic::object("latitude", "1")("longitude", 2))).error ==
        "Location to reverse-geocode must be an object with number properties `latitude` and `longitude`");
  CHECK(*ask(*module, "reverseGeocodeAsync", dynamic::array()).error ==
        "Location to reverse-geocode must be an object with number properties `latitude` and `longitude`");
  CHECK(geocoder->asked.empty());
}

TEST_CASE("NgNativeLocation without a geocoder has no geocoding methods, so the service gives no places") {
  auto module = ngn::makeLocationModule(std::make_shared<FakeLocation>(), false);
  CHECK(module->methods().count("geocodeAsync") == 0);
  CHECK(module->methods().count("reverseGeocodeAsync") == 0);
}
