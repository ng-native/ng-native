// The MapKit half of `<expo-map>` (the core's maps.h), with no Fabric in it: an MKMapView that
// shows a MapModel and reports the iOS view's events through a callback. `map-view.mm` puts it in
// the view tree. Main thread only.
#pragma once

#import <AppKit/AppKit.h>
#import <MapKit/MapKit.h>

#include "ngn/maps.h"

#include <functional>
#include <optional>
#include <string>

using NGNMapEvents = std::function<void(const ngn::MapEvent &)>;
using NGNMapAccess = std::function<ngn::LocationSource::Authorization()>;

@interface NGNMap : NSObject <MKMapViewDelegate>
@property (nonatomic, readonly) MKMapView *mapView;
// `access` says whether location is allowed, for the user's location; it never asks.
- (instancetype)initWithFrame:(NSRect)frame events:(NGNMapEvents)events access:(NGNMapAccess)access;
// Shows `model`: markers and shapes when their lists changed, the camera when its prop did.
- (void)apply:(const ngn::MapModel &)model;
// Sends `cameraMove` for the region shown, the first time it is called: the map has appeared.
- (void)appear;
// setCameraPosition: no camera centres on the user's location, where it shows.
- (void)moveCamera:(const std::optional<ngn::MapCamera> &)camera;
- (void)selectMarker:(const std::optional<std::string> &)markerId zoom:(std::optional<double>)zoom moveCamera:(bool)moveCamera;
// A click at `point` in the map view: nothing on a marker (MapKit selects it), else the shape's
// event or `mapClick`.
- (void)clickAt:(NSPoint)point;
@end

// An ARGB colour, or `fallback` where there is none.
NSColor *NGNMapColor(std::optional<uint32_t> argb, NSColor *fallback);
