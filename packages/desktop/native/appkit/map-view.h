// `<expo-map>`'s view on macOS: an NGNView holding NGNMap's MKMapView (maps.h), showing the props
// as they change, sending the map's events to the view's emitter, and registered with NgNativeMaps
// by its tag while it is mounted.
#pragma once

#import "host-view.h"

#include "ngn/maps.h"

#include <memory>

@interface NGNMapView : NGNView
// Set once by the host: the maps NgNativeMaps reaches, and the location the maps may show.
+ (void)useViews:(std::shared_ptr<ngn::MapViews>)views location:(std::shared_ptr<ngn::LocationSource>)location;
@end
