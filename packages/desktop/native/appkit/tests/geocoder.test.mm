// CoreLocationGeocoder (geocoder.mm), live: CLGeocoder needs no permission, only the network, so
// where the network is out the test says so and checks nothing more.
#include "../geocoder.h"

#include <doctest/doctest.h>

#import <Foundation/Foundation.h>

namespace {

// CLGeocoder answers on the main thread, which this test runs on: it turns the run loop until then.
ngn::Geocoder::Answer wait(std::function<void(std::function<void(ngn::Geocoder::Answer)>)> ask) {
  std::optional<ngn::Geocoder::Answer> answer;
  ask([&](ngn::Geocoder::Answer a) { answer = std::move(a); });
  NSDate *until = [NSDate dateWithTimeIntervalSinceNow:30];
  while (!answer && [until timeIntervalSinceNow] > 0) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, false);
  }
  REQUIRE(answer);
  return *answer;
}

bool offline(const ngn::Geocoder::Answer &answer) {
  if (answer.failure == ngn::Geocoder::Failure::Network) {
    MESSAGE("the geocoder is unreachable here; only the request ran: ", answer.reason);
    return true;
  }
  return false;
}

} // namespace

TEST_CASE("CoreLocationGeocoder reverse geocodes a point into expo's address fields, with no permission") {
  auto geocoder = ngn::appkit::makeGeocoder();
  auto answer = wait([&](auto done) { geocoder->reverseGeocode(51.50083, -0.12457, done); });
  if (offline(answer)) {
    return;
  }
  REQUIRE(answer.failure == ngn::Geocoder::Failure::None);
  REQUIRE_FALSE(answer.places.empty());
  const auto &address = answer.places[0].address;
  CHECK(address.at("isoCountryCode") == "GB");
  CHECK(address.at("timezone") == "Europe/London");
  CHECK(address.count("city") == 1);
}

TEST_CASE("CoreLocationGeocoder geocodes an address to its point") {
  auto geocoder = ngn::appkit::makeGeocoder();
  auto answer = wait([&](auto done) { geocoder->geocode("Westminster Bridge, London", done); });
  if (offline(answer)) {
    return;
  }
  REQUIRE_FALSE(answer.places.empty());
  REQUIRE(answer.places[0].latitude);
  CHECK(*answer.places[0].latitude == doctest::Approx(51.5).epsilon(0.01));
  CHECK(*answer.places[0].longitude == doctest::Approx(-0.12).epsilon(0.5));
}

TEST_CASE("geocoderAnswer reads no result as no places, the network as Network, and any other error as Failed") {
  auto error = [](NSInteger code) {
    return [NSError errorWithDomain:kCLErrorDomain code:code userInfo:@{NSLocalizedDescriptionKey : @"why"}];
  };
  auto none = ngn::appkit::geocoderAnswer(nil, error(kCLErrorGeocodeFoundNoResult));
  CHECK(none.failure == ngn::Geocoder::Failure::NoResult);
  CHECK(ngn::appkit::geocoderAnswer(nil, error(kCLErrorGeocodeFoundPartialResult)).failure == ngn::Geocoder::Failure::NoResult);
  CHECK(ngn::appkit::geocoderAnswer(nil, error(kCLErrorNetwork)).failure == ngn::Geocoder::Failure::Network);
  auto failed = ngn::appkit::geocoderAnswer(nil, error(kCLErrorGeocodeCanceled));
  CHECK(failed.failure == ngn::Geocoder::Failure::Failed);
  CHECK(failed.reason == "why");
  CHECK(ngn::appkit::geocoderAnswer(@[], nil).failure == ngn::Geocoder::Failure::None);
}
