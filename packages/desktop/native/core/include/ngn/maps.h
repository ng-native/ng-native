// `<expo-map>` on a desktop host: expo-maps' Apple map (ViewManagerAdapter_ExpoAppleMaps, which
// `registerExpoMap('macos')` commits) as a Fabric component of the desktop's own, drawn by the
// AppKit backend with MKMapView, and NgNativeMaps, the module @ng-native/expo's MapView calls the
// view's functions through, by the view's tag.
//
// The core holds what does not need MapKit: the props as expo-maps' iOS view reads them (markers,
// polylines, polygons, circles, the camera, the map's properties, its controls and colour scheme),
// the camera's zoom as a span and back, which shape a click lands on, and each event's payload in
// the iOS view's shape:
//
// - cameraMove: {coordinates, latitudeDelta, longitudeDelta, zoom, tilt, bearing}, whenever the
//   region changes, and once when the map first appears;
// - mapClick: {coordinates}, a click on no marker and no shape;
// - markerClick: the marker's id, title, tintColor, systemImage, monogram and coordinates, when it
//   is selected, by a click or by selectMarker;
// - polygonClick, circleClick, polylineClick: the shape as committed (colours are the processed
//   values), checked in that order, as on iOS.
//
// - setCameraPosition(tag, position): moves the view `tag`'s camera; with no position, to the
//   user's location when the map shows it.
// - selectMarker(tag, id, {zoom, moveCamera}): selects the marker `id` (none clears the selection)
//   and moves the camera to it unless `moveCamera` is false.
//
// The map shows the user's location (`properties.isMyLocationEnabled`) only once location is
// allowed: the view never asks, as expo-maps' iOS view does not.
#pragma once

#include "ngn/desktop-props.h"
#include "ngn/location.h"
#include "ngn/native-module.h"

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

#include <folly/dynamic.h>

#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

extern const char MapComponentName[];

class MapProps final : public facebook::react::ViewProps, public HasDesktopProps {
 public:
  MapProps() = default;
  MapProps(
      const facebook::react::PropsParserContext &context,
      const MapProps &sourceProps,
      const facebook::react::RawProps &rawProps);
  // Every prop as committed, the last value of each: a `null` removes one.
  folly::dynamic values = folly::dynamic::object();
};

using MapShadowNode = facebook::react::ConcreteViewShadowNode<MapComponentName, MapProps, facebook::react::ViewEventEmitter>;
using MapComponentDescriptor = facebook::react::ConcreteComponentDescriptor<MapShadowNode>;

struct MapCoordinate {
  double latitude{0};
  double longitude{0};
  bool operator==(const MapCoordinate &) const = default;
};

struct MapMarker {
  std::string id;
  MapCoordinate coordinates;
  std::string title;
  // An SF Symbol's name, drawn in the balloon; else the monogram's letters.
  std::string systemImage;
  std::string monogram;
  // ARGB; unset is the system red.
  std::optional<uint32_t> tint;
  // The marker as committed.
  folly::dynamic given;
};

struct MapPolyline {
  std::string id;
  std::vector<MapCoordinate> coordinates;
  // Unset is the system blue.
  std::optional<uint32_t> color;
  double width{4};
  // `contourStyle: 'GEODESIC'`: along the Earth's curve.
  bool geodesic{false};
  folly::dynamic given;
};

struct MapPolygon {
  std::string id;
  std::vector<MapCoordinate> coordinates;
  // The fill; unset is the system blue. No line colour draws no line.
  std::optional<uint32_t> color;
  std::optional<uint32_t> lineColor;
  double lineWidth{0};
  folly::dynamic given;
};

struct MapCircle {
  std::string id;
  MapCoordinate center;
  // Metres.
  double radius{0};
  // The fill; unset is the system green.
  std::optional<uint32_t> color;
  std::optional<uint32_t> lineColor;
  double lineWidth{0};
  folly::dynamic given;
};

struct MapCamera {
  MapCoordinate coordinates;
  double zoom{1};
  bool operator==(const MapCamera &) const = default;
};

struct MapSpan {
  double latitudeDelta{0};
  double longitudeDelta{0};
};

enum class MapType { Standard, Hybrid, Imagery };
enum class MapColorScheme { Automatic, Light, Dark };

// The map as the props describe it, read as expo-maps' iOS view reads them, with its defaults.
struct MapModel {
  std::vector<MapMarker> markers;
  std::vector<MapPolyline> polylines;
  std::vector<MapPolygon> polygons;
  std::vector<MapCircle> circles;
  // The lists as committed, to tell whether one changed.
  folly::dynamic givenMarkers;
  folly::dynamic givenShapes;
  std::optional<MapCamera> camera;

  // properties
  bool myLocation{false};
  MapType type{MapType::Standard};
  bool traffic{false};
  bool selection{true};
  // Metres from a polyline that a click still lands on it.
  double polylineTapThreshold{20};
  bool realisticElevation{false};
  bool mutedEmphasis{false};
  // MapKit's category names (`MKPOICategoryMuseum`): only these, or all but these. Neither shows
  // every category.
  std::optional<std::vector<std::string>> pointsIncluding;
  std::optional<std::vector<std::string>> pointsExcluding;

  // uiSettings
  bool compass{true};
  bool scaleBar{false};
  bool pitchToggle{true};
  bool userLocationButton{true};

  MapColorScheme colorScheme{MapColorScheme::Automatic};
};

MapModel mapModel(const folly::dynamic &props);

// A colour as expo-maps takes one: a processed ARGB number, `#rgb`, `#rgba`, `#rrggbb`,
// `#rrggbbaa` or a CSS colour name. Unset for anything else.
std::optional<uint32_t> mapColor(const folly::dynamic &value);

// MapKit's name for expo-maps' point of interest category: `EV_CHARGER` is `MKPOICategoryEVCharger`.
std::string mapPointOfInterestCategory(const std::string &expoName);

// expo-maps' zoom as the span it shows, and the span's zoom: 360 / 2^zoom degrees each way.
MapSpan mapSpanForZoom(double zoom);
double mapZoomForSpan(double longitudeDelta);

// A position as setCameraPosition and the `cameraPosition` prop take it: unset without coordinates.
std::optional<MapCamera> mapCameraOf(const folly::dynamic &position);

// Metres between two points, along the Earth's surface.
double mapDistance(MapCoordinate a, MapCoordinate b);
// The points along the great circle from `a` to `b`, both included, as expo-maps hit-tests a
// geodesic polyline.
std::vector<MapCoordinate> mapGreatCircle(MapCoordinate a, MapCoordinate b, int segments = 30);

struct MapEvent {
  // As the view sends it, without `on`: `mapClick`.
  std::string name;
  folly::dynamic payload;
};

// What a click at `tap` that landed on no marker is: a polygon's, a circle's or a polyline's, in
// that order, or the map's.
MapEvent mapClickAt(const MapModel &map, MapCoordinate tap);
MapEvent mapMarkerClick(const MapMarker &marker);
MapEvent mapCameraMove(MapCoordinate center, MapSpan span, double pitch, double heading);

// Whether the map shows the user's location: asked for, and allowed.
bool mapShowsUserLocation(const MapModel &map, LocationSource::Authorization authorization);

// A view's map, as NgNativeMaps drives it. Any thread.
class MapController {
 public:
  virtual ~MapController() = default;
  // No camera moves to the user's location, where the map shows it.
  virtual void setCamera(std::optional<MapCamera> camera) = 0;
  // No id clears the selection.
  virtual void selectMarker(std::optional<std::string> id, std::optional<double> zoom, bool moveCamera) = 0;
};

// The mounted maps by view tag, shared by the views and NgNativeMaps. Any thread.
class MapViews {
 public:
  void attach(int tag, std::shared_ptr<MapController> map);
  void detach(int tag);
  std::shared_ptr<MapController> find(int tag) const;

 private:
  mutable std::mutex mutex_;
  std::map<int, std::shared_ptr<MapController>> maps_;
};

std::shared_ptr<NativeModule> makeMapsModule(std::shared_ptr<MapViews> views);

} // namespace ngn
