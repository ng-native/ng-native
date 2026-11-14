// The geocoding half of NgNativeLocation (the core's location.h Geocoder): CLGeocoder, which needs
// no location permission. It answers on the main thread.
#pragma once

#include "ngn/location.h"

#import <CoreLocation/CoreLocation.h>

#include <memory>

namespace ngn::appkit {

std::shared_ptr<Geocoder> makeGeocoder();

// What CLGeocoder's completion gives, as the core's answer: no result and a partial result as no
// places, kCLErrorNetwork (offline or rate limited) as Network, any other error as Failed.
Geocoder::Answer geocoderAnswer(NSArray<CLPlacemark *> *placemarks, NSError *error);

} // namespace ngn::appkit
