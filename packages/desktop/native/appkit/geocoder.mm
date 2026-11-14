#include "geocoder.h"

#import <CoreLocation/CoreLocation.h>
#import <Foundation/Foundation.h>

namespace ngn::appkit {

namespace {

using Answer = Geocoder::Answer;

void put(std::map<std::string, std::string> &address, const char *field, NSString *value) {
  if (value.length > 0) {
    address[field] = value.UTF8String;
  }
}

Geocoder::Place placeOf(CLPlacemark *placemark) {
  Geocoder::Place place;
  if (CLLocation *location = placemark.location) {
    place.latitude = location.coordinate.latitude;
    place.longitude = location.coordinate.longitude;
    place.altitude = location.ellipsoidalAltitude;
    if (location.horizontalAccuracy >= 0) {
      place.accuracy = location.horizontalAccuracy;
    }
  }
  // expo-location's iOS names for CLPlacemark's fields.
  put(place.address, "city", placemark.locality);
  put(place.address, "district", placemark.subLocality);
  put(place.address, "streetNumber", placemark.subThoroughfare);
  put(place.address, "street", placemark.thoroughfare);
  put(place.address, "region", placemark.administrativeArea);
  put(place.address, "subregion", placemark.subAdministrativeArea);
  put(place.address, "country", placemark.country);
  put(place.address, "postalCode", placemark.postalCode);
  put(place.address, "name", placemark.name);
  put(place.address, "isoCountryCode", placemark.ISOcountryCode);
  put(place.address, "timezone", placemark.timeZone.name);
  return place;
}

CLGeocodeCompletionHandler answering(std::function<void(Answer)> done) {
  auto answer = std::make_shared<std::function<void(Answer)>>(std::move(done));
  return ^(NSArray<CLPlacemark *> *placemarks, NSError *error) {
    (*answer)(geocoderAnswer(placemarks, error));
  };
}

class CoreLocationGeocoder final : public Geocoder {
 public:
  // A geocoder per request, as expo-location's: one CLGeocoder runs one request at a time.
  void geocode(const std::string &address, std::function<void(Answer)> done) override {
    CLGeocoder *geocoder = [CLGeocoder new];
    auto handler = answering(std::move(done));
    NSString *text = [NSString stringWithUTF8String:address.c_str()];
    [geocoder geocodeAddressString:text != nil ? text : @""
                 completionHandler:^(NSArray<CLPlacemark *> *placemarks, NSError *error) {
                   (void)geocoder;
                   handler(placemarks, error);
                 }];
  }

  void reverseGeocode(double latitude, double longitude, std::function<void(Answer)> done) override {
    CLGeocoder *geocoder = [CLGeocoder new];
    auto handler = answering(std::move(done));
    CLLocation *location = [[CLLocation alloc] initWithLatitude:latitude longitude:longitude];
    [geocoder reverseGeocodeLocation:location
                   completionHandler:^(NSArray<CLPlacemark *> *placemarks, NSError *error) {
                     (void)geocoder;
                     handler(placemarks, error);
                   }];
  }
};

} // namespace

Geocoder::Answer geocoderAnswer(NSArray<CLPlacemark *> *placemarks, NSError *error) {
  Answer result;
  if (error) {
    bool none = [error.domain isEqualToString:kCLErrorDomain] &&
        (error.code == kCLErrorGeocodeFoundNoResult || error.code == kCLErrorGeocodeFoundPartialResult);
    bool network = [error.domain isEqualToString:kCLErrorDomain] && error.code == kCLErrorNetwork;
    result.failure = none ? Geocoder::Failure::NoResult : network ? Geocoder::Failure::Network : Geocoder::Failure::Failed;
    result.reason = error.localizedDescription.length > 0 ? error.localizedDescription.UTF8String : "";
    return result;
  }
  for (CLPlacemark *placemark in placemarks) {
    result.places.push_back(placeOf(placemark));
  }
  return result;
}

std::shared_ptr<Geocoder> makeGeocoder() {
  return std::make_shared<CoreLocationGeocoder>();
}

} // namespace ngn::appkit
