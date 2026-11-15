// CoreLocationGeocoder (geocoder.mm), live: CLGeocoder needs no permission, only the network, so
// where the network is out the test says so and checks nothing more.
#include "../geocoder.h"

#include <doctest/doctest.h>

#include <cstdlib>
#import <Foundation/Foundation.h>
#import <MapKit/MapKit.h>

// A placemark built offline, with a location and fields of the test's choosing.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
@interface NGNTestPlacemark : MKPlacemark
@property(nonatomic, strong) CLLocation *fixedLocation;
@end
#pragma clang diagnostic pop

@implementation NGNTestPlacemark
- (CLLocation *)location {
  return _fixedLocation;
}
- (NSString *)subThoroughfare {
  return @"221B";
}
- (NSString *)thoroughfare {
  return @"Baker Street";
}
- (NSString *)locality {
  return @"London";
}
- (NSString *)ISOcountryCode {
  return @"GB";
}
- (NSString *)postalCode {
  return @"";
}
@end

namespace {

NGNTestPlacemark *placemarkAt(double altitude, double horizontal, double vertical) {
  CLLocationCoordinate2D point = CLLocationCoordinate2DMake(51.5238, -0.1586);
  NGNTestPlacemark *placemark = [[NGNTestPlacemark alloc] initWithCoordinate:point];
  placemark.fixedLocation = [[CLLocation alloc] initWithCoordinate:point
                                                          altitude:altitude
                                                horizontalAccuracy:horizontal
                                                  verticalAccuracy:vertical
                                                         timestamp:[NSDate date]];
  return placemark;
}

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
  // Live: the answer depends on Apple's servers and where the machine is, so it is run on a Mac
  // here and skipped in CI, where a runner's network and location make it flaky.
  if (std::getenv("CI") != nullptr) {
    MESSAGE("skipped in CI: a live MapKit request");
    return;
  }

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
  // Live: the answer depends on Apple's servers and where the machine is, so it is run on a Mac
  // here and skipped in CI, where a runner's network and location make it flaky.
  if (std::getenv("CI") != nullptr) {
    MESSAGE("skipped in CI: a live MapKit request");
    return;
  }

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

TEST_CASE("geocoderAnswer maps a placemark to expo's fields, with altitude and accuracy only where valid") {
  auto known = ngn::appkit::geocoderAnswer(@[ placemarkAt(35, 12, 4) ], nil);
  REQUIRE(known.places.size() == 1);
  const auto &place = known.places[0];
  CHECK(place.latitude == doctest::Approx(51.5238));
  CHECK(place.longitude == doctest::Approx(-0.1586));
  CHECK(place.altitude.has_value());
  CHECK(place.accuracy == doctest::Approx(12));
  CHECK(place.address.at("streetNumber") == "221B");
  CHECK(place.address.at("street") == "Baker Street");
  CHECK(place.address.at("city") == "London");
  CHECK(place.address.at("isoCountryCode") == "GB");
  // An empty field is left out.
  CHECK(place.address.count("postalCode") == 0);

  // A vertical accuracy of 0 or less, or a negative horizontal one, means the value is not known.
  for (double vertical : {0.0, -1.0}) {
    auto unknown = ngn::appkit::geocoderAnswer(@[ placemarkAt(0, -1, vertical) ], nil);
    REQUIRE(unknown.places.size() == 1);
    CHECK_FALSE(unknown.places[0].altitude.has_value());
    CHECK_FALSE(unknown.places[0].accuracy.has_value());
  }
}
