// MapKitLookup (address-search.mm): a placemark's parts offline, and a live completion and lookup,
// which need no permission, only the network: where MapKit cannot be reached, the test says so.
#include "../address-search.h"

#include <doctest/doctest.h>

#import <Foundation/Foundation.h>

namespace {

// MapKit answers on the main thread, which this test runs on: it turns the run loop until `done`.
template <typename Done>
void turnUntil(Done done, double seconds = 30) {
  NSDate *until = [NSDate dateWithTimeIntervalSinceNow:seconds];
  while (!done() && [until timeIntervalSinceNow] > 0) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, false);
  }
}

} // namespace

TEST_CASE("postalAddressOf puts the street number and street on the first line, and leaves out what MapKit does not name") {
  MKPlacemark *placemark = [[MKPlacemark alloc] initWithCoordinate:CLLocationCoordinate2DMake(53.81, -1.56)
                                                 addressDictionary:@{
                                                   @"SubThoroughfare" : @"22",
                                                   @"Thoroughfare" : @"Hyde Park Terrace",
                                                   @"City" : @"Leeds",
                                                   @"ZIP" : @"LS6 1BJ",
                                                   @"Country" : @"United Kingdom",
                                                   @"CountryCode" : @"GB",
                                                   @"State" : @"England",
                                                 }];
  auto parts = ngn::appkit::postalAddressOf(placemark);
  CHECK(parts.line1 == "22 Hyde Park Terrace");
  CHECK(parts.town == "Leeds");
  CHECK(parts.postcode == "LS6 1BJ");
  CHECK(parts.country == "United Kingdom");
  CHECK(parts.countryCode == "GB");
  CHECK(parts.region == std::optional<std::string>("England"));
  CHECK_FALSE(parts.locality);
  CHECK(parts.latitude == doctest::Approx(53.81));
  CHECK(parts.longitude == doctest::Approx(-1.56));

  MKPlacemark *bare = [[MKPlacemark alloc] initWithCoordinate:CLLocationCoordinate2DMake(0, 0) addressDictionary:@{@"Thoroughfare" : @"High Street"}];
  auto street = ngn::appkit::postalAddressOf(bare);
  CHECK(street.line1 == "High Street");
  CHECK(street.town.empty());
  CHECK_FALSE(street.region);
}

TEST_CASE("MapKitLookup completes a query in a country and looks the first completion up, live") {
  auto lookup = ngn::appkit::makeAddressLookup();
  std::optional<std::vector<ngn::AddressCompletion>> found;
  std::optional<std::string> failure;
  auto completer = lookup->makeCompleter({
      .results =
          [&](const std::string &query, std::vector<ngn::AddressCompletion> completions) {
            if (query == "10 Downing Street" && !completions.empty()) {
              found = std::move(completions);
            }
          },
      .failed = [&](const std::string &, const std::string &reason) { failure = reason; },
  });
  completer->complete("10 Downing Street", "gb", false);
  turnUntil([&] { return found || failure; });
  if (!found) {
    MESSAGE("MapKit's search is unreachable here; only the request ran: ", failure.value_or("no answer in 30 s"));
    completer.reset();
    return;
  }
  CHECK((*found)[0].title.find("Downing") != std::string::npos);
  std::optional<ngn::PostalAddressParts> address;
  std::string error;
  bool answered = false;
  lookup->lookup((*found)[0].handle, [&](std::optional<ngn::PostalAddressParts> parts, std::string why) {
    address = std::move(parts);
    error = std::move(why);
    answered = true;
  });
  turnUntil([&] { return answered; });
  REQUIRE(answered);
  if (!address) {
    MESSAGE("MapKit found no place for the completion: ", error);
  } else {
    CHECK(address->countryCode == "GB");
    CHECK(address->latitude == doctest::Approx(51.5).epsilon(0.01));
  }
  completer->cancel();
  completer.reset();
  // The stop runs on the main thread.
  turnUntil([] { return false; }, 0.2);
}
