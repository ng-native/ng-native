// The MapKit half of `<expo-map>` (maps.mm) on an MKMapView in no window: what it shows for a
// model, the shapes drawn offscreen into bitmaps, the camera, the clicks and the events. Location is
// never allowed here, so nothing starts CoreLocation and nothing prompts.
#include "../maps.h"

#include <doctest/doctest.h>

#include <array>
#include <cmath>
#include <vector>

using folly::dynamic;
using Authorization = ngn::LocationSource::Authorization;

namespace {

dynamic at(double latitude, double longitude) {
  return dynamic::object("latitude", latitude)("longitude", longitude);
}

struct Harness {
  std::vector<ngn::MapEvent> events;
  Authorization access{Authorization::Denied};
  NGNMap *map = [[NGNMap alloc] initWithFrame:NSMakeRect(0, 0, 400, 300)
                                       events:[this](const ngn::MapEvent &event) { events.push_back(event); }
                                       access:[this] { return access; }];
};

template <typename T>
std::vector<T *> of(NSArray *items) {
  std::vector<T *> out;
  for (id item in items) {
    if ([item isKindOfClass:[T class]]) {
      out.push_back(item);
    }
  }
  return out;
}

// The red, green, blue and alpha at the centre of `renderer`'s overlay, drawn alone into a bitmap.
std::array<int, 4> centreOf(MKOverlayRenderer *renderer) {
  MKMapRect bounds = renderer.overlay.boundingMapRect;
  const int size = 64;
  double scale = size / std::max(bounds.size.width, bounds.size.height);
  std::vector<uint8_t> pixels(size * size * 4, 0);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(pixels.data(), size, size, 8, size * 4, space, kCGImageAlphaPremultipliedLast);
  CGContextScaleCTM(context, scale, scale);
  [renderer drawMapRect:bounds zoomScale:scale inContext:context];
  CGContextRelease(context);
  CGColorSpaceRelease(space);
  int x = static_cast<int>(bounds.size.width * scale / 2);
  int y = static_cast<int>(bounds.size.height * scale / 2);
  const uint8_t *p = &pixels[(y * size + x) * 4];
  return {p[0], p[1], p[2], p[3]};
}

bool near(std::array<int, 4> pixel, std::array<int, 4> expected) {
  for (int i = 0; i < 4; i++) {
    if (std::abs(pixel[i] - expected[i]) > 3) {
      return false;
    }
  }
  return true;
}

} // namespace

TEST_CASE("NGNMap shows each marker as a balloon with its title, tint, symbol or monogram") {
  Harness h;
  [h.map apply:ngn::mapModel(dynamic::object(
                   "markers", dynamic::array(
                                  dynamic::object("id", "kx")("coordinates", at(51.53, -0.12))("title", "King's Cross")("systemImage", "tram.fill")(
                                      "tintColor", "#00ff00"),
                                  dynamic::object("id", "ab")("coordinates", at(51.5, -0.1))("monogram", "AB"))))];
  auto annotations = of<MKPointAnnotation>(h.map.mapView.annotations);
  REQUIRE(annotations.size() == 2);
  MKPointAnnotation *kx = [annotations[0].title isEqualToString:@"King's Cross"] ? annotations[0] : annotations[1];
  CHECK(kx.coordinate.latitude == doctest::Approx(51.53));
  auto *view = (MKMarkerAnnotationView *)[h.map mapView:h.map.mapView viewForAnnotation:kx];
  REQUIRE([view isKindOfClass:MKMarkerAnnotationView.class]);
  NSColor *tint = [view.markerTintColor colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
  CHECK(tint.greenComponent == doctest::Approx(1));
  CHECK(tint.redComponent == doctest::Approx(0));
  CHECK(bool(view.glyphImage != nil));
  MKPointAnnotation *ab = kx == annotations[0] ? annotations[1] : annotations[0];
  auto *monogram = (MKMarkerAnnotationView *)[h.map mapView:h.map.mapView viewForAnnotation:ab];
  CHECK([monogram.glyphText isEqualToString:@"AB"]);
  CHECK(bool(monogram.glyphImage == nil));

  // The same markers again add nothing; a changed list replaces them.
  [h.map apply:ngn::mapModel(dynamic::object("markers", dynamic::array(dynamic::object("id", "kx")("coordinates", at(51.53, -0.12))(
                                                                         "title", "King's Cross")("systemImage", "tram.fill")("tintColor", "#00ff00"),
                                                                     dynamic::object("id", "ab")("coordinates", at(51.5, -0.1))("monogram", "AB"))))];
  CHECK(of<MKPointAnnotation>(h.map.mapView.annotations).size() == 2);
  [h.map apply:ngn::mapModel(dynamic::object("markers", dynamic::array(dynamic::object("id", "kx")("coordinates", at(1, 1)))))];
  CHECK(of<MKPointAnnotation>(h.map.mapView.annotations).size() == 1);
  [h.map apply:ngn::mapModel(dynamic::object())];
  CHECK(of<MKPointAnnotation>(h.map.mapView.annotations).empty());
}

TEST_CASE("NGNMap draws polylines, polygons and circles with their colours and widths, offscreen") {
  Harness h;
  [h.map apply:ngn::mapModel(dynamic::object(
                   "polylines", dynamic::array(dynamic::object("id", "straight")("coordinates", dynamic::array(at(0, 0), at(1, 1)))("width", 6)(
                                                   "color", 0xffff0000u),
                                               dynamic::object("id", "curve")("coordinates", dynamic::array(at(50, -100), at(50, 100)))(
                                                   "contourStyle", "GEODESIC")))(
                   "polygons", dynamic::array(dynamic::object("id", "p")("coordinates", dynamic::array(at(10, 10), at(10, 11), at(11, 11), at(11, 10)))(
                                   "color", "#0000ff")("lineColor", "#ffffff")("lineWidth", 3)))(
                   "circles", dynamic::array(dynamic::object("id", "c")("center", at(20, 20))("radius", 5000)("color", 0xff00ff00u))))];
  NSArray *overlays = h.map.mapView.overlays;
  REQUIRE(overlays.count == 4);
  auto lines = of<MKPolyline>(overlays);
  REQUIRE(lines.size() == 2);
  CHECK(of<MKGeodesicPolyline>(overlays).size() == 1);
  MKPolyline *straight = [lines[0] isKindOfClass:MKGeodesicPolyline.class] ? lines[1] : lines[0];
  auto *lineRenderer = (MKPolylineRenderer *)[h.map mapView:h.map.mapView rendererForOverlay:straight];
  REQUIRE([lineRenderer isKindOfClass:MKPolylineRenderer.class]);
  CHECK(lineRenderer.lineWidth == 6);
  CHECK([lineRenderer.strokeColor colorUsingColorSpace:NSColorSpace.sRGBColorSpace].redComponent == doctest::Approx(1));

  auto polygons = of<MKPolygon>(overlays);
  REQUIRE(polygons.size() == 1);
  auto *polygonRenderer = (MKPolygonRenderer *)[h.map mapView:h.map.mapView rendererForOverlay:polygons[0]];
  CHECK(polygonRenderer.lineWidth == 3);
  CHECK(near(centreOf(polygonRenderer), {0, 0, 255, 255}));

  auto circles = of<MKCircle>(overlays);
  REQUIRE(circles.size() == 1);
  CHECK(circles[0].radius == 5000);
  auto *circleRenderer = [h.map mapView:h.map.mapView rendererForOverlay:circles[0]];
  CHECK(near(centreOf(circleRenderer), {0, 255, 0, 255}));

  // A changed list replaces the shapes, and none removes them.
  [h.map apply:ngn::mapModel(dynamic::object("circles", dynamic::array(dynamic::object("center", at(1, 1))("radius", 10))))];
  CHECK(h.map.mapView.overlays.count == 1);
  [h.map apply:ngn::mapModel(dynamic::object())];
  CHECK(h.map.mapView.overlays.count == 0);
}

TEST_CASE("NGNMap moves the camera when its prop changes and leaves it where the user put it otherwise") {
  Harness h;
  dynamic props = dynamic::object("cameraPosition", dynamic::object("coordinates", at(51.5, -0.1))("zoom", 10));
  [h.map apply:ngn::mapModel(props)];
  MKCoordinateRegion region = h.map.mapView.region;
  CHECK(region.center.latitude == doctest::Approx(51.5).epsilon(0.001));
  CHECK(region.center.longitude == doctest::Approx(-0.1).epsilon(0.001));
  CHECK(ngn::mapZoomForSpan(region.span.longitudeDelta) == doctest::Approx(10).epsilon(0.1));

  // The user pans; a commit of other props leaves the camera there.
  [h.map.mapView setCenterCoordinate:CLLocationCoordinate2DMake(48.85, 2.35) animated:NO];
  props["colorScheme"] = "DARK";
  [h.map apply:ngn::mapModel(props)];
  CHECK(h.map.mapView.region.center.latitude == doctest::Approx(48.85).epsilon(0.001));

  props["cameraPosition"] = dynamic::object("coordinates", at(40.7, -74))("zoom", 10);
  [h.map apply:ngn::mapModel(props)];
  CHECK(h.map.mapView.region.center.latitude == doctest::Approx(40.7).epsilon(0.001));

  // setCameraPosition, then with no position: the user's location is not shown, so nothing moves.
  [h.map moveCamera:ngn::MapCamera{{35.68, 139.69}, 12}];
  CHECK(h.map.mapView.region.center.latitude == doctest::Approx(35.68).epsilon(0.001));
  [h.map moveCamera:std::nullopt];
  CHECK(h.map.mapView.region.center.latitude == doctest::Approx(35.68).epsilon(0.001));
}

TEST_CASE("NGNMap sends cameraMove once as it appears, and as the region changes, in the iOS view's shape") {
  Harness h;
  [h.map apply:ngn::mapModel(dynamic::object("cameraPosition", dynamic::object("coordinates", at(51.5, -0.1))("zoom", 10)))];
  h.events.clear();
  [h.map appear];
  [h.map appear];
  REQUIRE(h.events.size() == 1);
  CHECK(h.events[0].name == "cameraMove");
  CHECK(h.events[0].payload["coordinates"]["latitude"].asDouble() == doctest::Approx(51.5).epsilon(0.001));
  CHECK(h.events[0].payload["zoom"].asDouble() == doctest::Approx(10).epsilon(0.1));
  [h.map mapView:h.map.mapView regionDidChangeAnimated:NO];
  CHECK(h.events.size() == 2);
  CHECK(h.events[1].name == "cameraMove");
}

TEST_CASE("NGNMap hands a click to a shape, to the map, and to no one on a marker") {
  Harness h;
  [h.map apply:ngn::mapModel(dynamic::object("cameraPosition", dynamic::object("coordinates", at(0, 0))("zoom", 6))(
                   "polygons", dynamic::array(dynamic::object("id", "p")("coordinates", dynamic::array(at(-1, -1), at(-1, 1), at(1, 1), at(1, -1)))))(
                   "markers", dynamic::array(dynamic::object("id", "m")("coordinates", at(-3, 3)))))];
  h.events.clear();
  MKMapView *mapView = h.map.mapView;
  [h.map clickAt:[mapView convertCoordinate:CLLocationCoordinate2DMake(0, 0) toPointToView:mapView]];
  REQUIRE(h.events.size() == 1);
  CHECK(h.events[0].name == "polygonClick");
  CHECK(h.events[0].payload["id"] == "p");

  CLLocationCoordinate2D empty = CLLocationCoordinate2DMake(3, -3);
  [h.map clickAt:[mapView convertCoordinate:empty toPointToView:mapView]];
  REQUIRE(h.events.size() == 2);
  CHECK(h.events[1].name == "mapClick");
  CHECK(h.events[1].payload["coordinates"]["latitude"].asDouble() == doctest::Approx(3).epsilon(0.01));
  CHECK(h.events[1].payload["coordinates"]["longitude"].asDouble() == doctest::Approx(-3).epsilon(0.01));

  // On the balloon, which hangs above its coordinate: MapKit selects the marker, and the click is not the map's.
  NSPoint tip = [mapView convertCoordinate:CLLocationCoordinate2DMake(-3, 3) toPointToView:mapView];
  NSPoint balloon = NSMakePoint(tip.x, tip.y + (mapView.isFlipped ? -20 : 20));
  [h.map clickAt:balloon];
  CHECK(h.events.size() == 2);
}

TEST_CASE("NGNMap selects a marker and moves to it, and a selected marker sends markerClick") {
  Harness h;
  [h.map apply:ngn::mapModel(dynamic::object("cameraPosition", dynamic::object("coordinates", at(0, 0))("zoom", 4))(
                   "markers", dynamic::array(dynamic::object("id", "kx")("coordinates", at(51.53, -0.12))("title", "King's Cross"))))];
  h.events.clear();
  [h.map selectMarker:std::string("kx") zoom:14 moveCamera:true];
  CHECK(h.map.mapView.region.center.latitude == doctest::Approx(51.53).epsilon(0.001));
  CHECK(ngn::mapZoomForSpan(h.map.mapView.region.span.longitudeDelta) == doctest::Approx(14).epsilon(0.1));
  REQUIRE(h.map.mapView.selectedAnnotations.count == 1);
  CHECK([h.map.mapView.selectedAnnotations[0].title isEqualToString:@"King's Cross"]);

  [h.map selectMarker:std::nullopt zoom:std::nullopt moveCamera:true];
  CHECK(h.map.mapView.selectedAnnotations.count == 0);
  [h.map.mapView setCenterCoordinate:CLLocationCoordinate2DMake(0, 0) animated:NO];
  [h.map selectMarker:std::string("kx") zoom:std::nullopt moveCamera:false];
  CHECK(h.map.mapView.region.center.latitude == doctest::Approx(0).epsilon(0.001));
  [h.map selectMarker:std::string("missing") zoom:std::nullopt moveCamera:true];
  CHECK(h.map.mapView.region.center.latitude == doctest::Approx(0).epsilon(0.001));

  h.events.clear();
  id<MKAnnotation> marker = h.map.mapView.annotations.firstObject;
  MKAnnotationView *view = [h.map mapView:h.map.mapView viewForAnnotation:marker];
  [h.map mapView:h.map.mapView didSelectAnnotationView:view];
  REQUIRE(h.events.size() == 1);
  CHECK(h.events[0].name == "markerClick");
  CHECK(h.events[0].payload["id"] == "kx");
  CHECK(h.events[0].payload["title"] == "King's Cross");
}

TEST_CASE("NGNMap shows the user's location only once location is allowed, and denied shows none") {
  Harness h;
  dynamic asked = dynamic::object("properties", dynamic::object("isMyLocationEnabled", true));
  h.access = Authorization::Denied;
  [h.map apply:ngn::mapModel(asked)];
  CHECK_FALSE(h.map.mapView.showsUserLocation);
  h.access = Authorization::NotDetermined;
  [h.map apply:ngn::mapModel(asked)];
  CHECK_FALSE(h.map.mapView.showsUserLocation);
  CHECK(ngn::mapShowsUserLocation(ngn::mapModel(asked), Authorization::Granted));
}

TEST_CASE("NGNMap takes the map type, traffic, points of interest, controls and colour scheme") {
  Harness h;
  [h.map apply:ngn::mapModel(dynamic::object(
                   "properties", dynamic::object("mapType", "STANDARD")("emphasis", "MUTED")("isTrafficEnabled", true)(
                                     "pointsOfInterest", dynamic::object("including", dynamic::array("MUSEUM", "EV_CHARGER", "ATM"))))(
                   "uiSettings", dynamic::object("compassEnabled", false)("scaleBarEnabled", true)("togglePitchEnabled", false))("colorScheme", "DARK"))];
  MKMapView *mapView = h.map.mapView;
  auto *standard = (MKStandardMapConfiguration *)mapView.preferredConfiguration;
  REQUIRE([standard isKindOfClass:MKStandardMapConfiguration.class]);
  CHECK(standard.emphasisStyle == MKStandardMapEmphasisStyleMuted);
  CHECK(standard.showsTraffic);
  CHECK([standard.pointOfInterestFilter includesCategory:MKPointOfInterestCategoryMuseum]);
  CHECK([standard.pointOfInterestFilter includesCategory:MKPointOfInterestCategoryEVCharger]);
  CHECK([standard.pointOfInterestFilter includesCategory:MKPointOfInterestCategoryATM]);
  CHECK_FALSE([standard.pointOfInterestFilter includesCategory:MKPointOfInterestCategoryCafe]);
  CHECK_FALSE(mapView.showsCompass);
  CHECK(mapView.showsScale);
  CHECK_FALSE(mapView.showsPitchControl);
  CHECK([mapView.appearance.name isEqualToString:NSAppearanceNameDarkAqua]);

  [h.map apply:ngn::mapModel(dynamic::object("properties", dynamic::object("mapType", "HYBRID")))];
  CHECK([mapView.preferredConfiguration isKindOfClass:MKHybridMapConfiguration.class]);
  CHECK(mapView.showsCompass);
  CHECK(bool(mapView.appearance == nil));
  [h.map apply:ngn::mapModel(dynamic::object("properties", dynamic::object("mapType", "IMAGERY")("elevation", "REALISTIC")))];
  auto *imagery = (MKImageryMapConfiguration *)mapView.preferredConfiguration;
  REQUIRE([imagery isKindOfClass:MKImageryMapConfiguration.class]);
  CHECK(imagery.elevationStyle == MKMapElevationStyleRealistic);
  [h.map apply:ngn::mapModel(dynamic::object("colorScheme", "LIGHT"))];
  CHECK([mapView.appearance.name isEqualToString:NSAppearanceNameAqua]);
}
