// The OS half of NgNativeLocation on Linux (the core's location.h): the Location portal, which asks
// GeoClue, inside a sandbox and outside one. Each fix and each watch is a portal session of its
// own; the portal decides on access as a session starts, so authorization is what the last start
// was answered, not determined until one has been. Where no Location portal answers, location is
// restricted. Geocoding is absent: there is no geocoder to ask.
#pragma once

#include "ngn/location.h"

#include <memory>

namespace ngn::gtk {

// The portal accuracy level (0 none to 5 exact) for an accuracy in metres; 0 or less is exact.
unsigned portalAccuracyOf(double metres);

std::shared_ptr<LocationSource> makeLocationSource();

} // namespace ngn::gtk
