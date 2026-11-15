// The OS half of NgNativeAddressSearch (the core's address-search.h): MapKit's
// MKLocalSearchCompleter for each session, on the main thread, and MKLocalSearch for the picked
// completion. A country's region is found once, by name, with CLGeocoder, as the iOS module does.
#pragma once

#include "ngn/address-search.h"

#import <MapKit/MapKit.h>

#include <memory>

namespace ngn::appkit {

std::shared_ptr<AddressLookup> makeAddressLookup();

// A placemark in the parts a form fills: the street number and street as the first line, and the
// sub-locality and the administrative area only where MapKit names them.
PostalAddressParts postalAddressOf(MKPlacemark *placemark);

} // namespace ngn::appkit
