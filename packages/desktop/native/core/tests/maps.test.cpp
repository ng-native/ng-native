#include "fake-backend.h"
#include "ngn/maps.h"
#include "ngn/mounting-manager.h"

#include <doctest/doctest.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/utils/ContextContainer.h>

#include <cmath>
#include <optional>

using namespace facebook::react;
using folly::dynamic;
using Authorization = ngn::LocationSource::Authorization;

namespace {

dynamic at(double latitude, double longitude) {
  return dynamic::object("latitude", latitude)("longitude", longitude);
}

std::shared_ptr<const ngn::MapProps> props(dynamic raw, Props::Shared source = nullptr) {
  static auto context = std::make_shared<const ContextContainer>();
  static ngn::MapComponentDescriptor descriptor({{}, context, nullptr});
  PropsParserContext parserContext{1, *context};
  return std::static_pointer_cast<const ngn::MapProps>(descriptor.cloneProps(parserContext, source, RawProps(std::move(raw))));
}

struct FakeMap final : ngn::MapController {
  std::vector<std::string> calls;
  void setCamera(std::optional<ngn::MapCamera> camera) override {
    calls.push_back(
        camera ? "camera " + std::to_string(camera->coordinates.latitude) + " " + std::to_string(camera->zoom) : "camera user");
  }
  void selectMarker(std::optional<std::string> id, std::optional<double> zoom, bool moveCamera) override {
    calls.push_back(
        "select " + id.value_or("none") + " " + (zoom ? std::to_string(*zoom) : "-") + (moveCamera ? " move" : " stay"));
  }
};

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

Answer call(const ngn::NativeModule &module, const std::string &method, dynamic args) {
  Answer answer;
  module.callWithPromise(method, args, {.resolve = [&](dynamic v) { answer.value = v; }, .reject = [&](const std::string &e) { answer.error = e; }});
  return answer;
}

} // namespace

TEST_CASE("the map commits under expo-maps' Apple view's name, keeping each prop until it is set again or removed") {
  CHECK(std::string(ngn::MapComponentName) == "ViewManagerAdapter_ExpoAppleMaps");
  auto backend = std::make_shared<ngn::testing::FakeBackend>();
  CHECK(std::make_shared<ngn::MountingManager>(backend, backend)->hasComponent(ngn::MapComponentName));
  auto first = props(dynamic::object("markers", dynamic::array(dynamic::object("id", "a")))("colorScheme", "DARK"));
  auto second = props(dynamic::object("colorScheme", nullptr), first);
  CHECK(second->values["markers"][0]["id"] == "a");
  CHECK(second->values.count("colorScheme") == 0);
}

TEST_CASE("mapModel reads the props as expo-maps' iOS view does, with its defaults") {
  auto empty = ngn::mapModel(dynamic::object());
  CHECK(empty.markers.empty());
  CHECK_FALSE(empty.camera);
  CHECK(empty.compass);
  CHECK(empty.pitchToggle);
  CHECK_FALSE(empty.scaleBar);
  CHECK(empty.selection);
  CHECK(empty.polylineTapThreshold == 20);
  CHECK(empty.type == ngn::MapType::Standard);
  CHECK(empty.colorScheme == ngn::MapColorScheme::Automatic);

  auto map = ngn::mapModel(dynamic::object(
      "markers",
      dynamic::array(
          dynamic::object("id", "kx")("coordinates", at(51.53, -0.12))("title", "King's Cross")("systemImage", "tram")("tintColor", "#ff5a36"),
          dynamic::object("coordinates", at(1, 2))("monogram", "AB")))(
      "polylines",
      dynamic::array(dynamic::object("id", "route")("coordinates", dynamic::array(at(0, 0), at(1, 1)))("color", 0xff00ff00)("width", 6)(
          "contourStyle", "GEODESIC")))(
      "polygons", dynamic::array(dynamic::object("coordinates", dynamic::array(at(0, 0), at(0, 1), at(1, 1)))("lineColor", "red")("lineWidth", 2)))(
      "circles", dynamic::array(dynamic::object("id", "c")("center", at(5, 5))("radius", 100)))(
      "cameraPosition", dynamic::object("coordinates", at(51.5, -0.1))("zoom", 12))(
      "properties",
      dynamic::object("isMyLocationEnabled", true)("mapType", "HYBRID")("isTrafficEnabled", true)("selectionEnabled", false)(
          "polylineTapThreshold", 50)("elevation", "REALISTIC")("emphasis", "MUTED")(
          "pointsOfInterest", dynamic::object("including", dynamic::array("MUSEUM", "EV_CHARGER"))))(
      "uiSettings", dynamic::object("compassEnabled", false)("scaleBarEnabled", true)("togglePitchEnabled", false))("colorScheme", "LIGHT"));

  REQUIRE(map.markers.size() == 2);
  CHECK(map.markers[0].id == "kx");
  CHECK(map.markers[0].coordinates == ngn::MapCoordinate{51.53, -0.12});
  CHECK(map.markers[0].title == "King's Cross");
  CHECK(map.markers[0].systemImage == "tram");
  CHECK(map.markers[0].tint == 0xffff5a36u);
  // A marker with no id gets one, as on iOS.
  CHECK_FALSE(map.markers[1].id.empty());
  CHECK(map.markers[1].monogram == "AB");
  CHECK_FALSE(map.markers[1].tint);

  REQUIRE(map.polylines.size() == 1);
  CHECK(map.polylines[0].color == 0xff00ff00u);
  CHECK(map.polylines[0].width == 6);
  CHECK(map.polylines[0].geodesic);
  REQUIRE(map.polygons.size() == 1);
  CHECK(map.polygons[0].coordinates.size() == 3);
  CHECK_FALSE(map.polygons[0].color);
  CHECK(map.polygons[0].lineColor == 0xffff0000u);
  CHECK(map.polygons[0].lineWidth == 2);
  REQUIRE(map.circles.size() == 1);
  CHECK(map.circles[0].center == ngn::MapCoordinate{5, 5});
  CHECK(map.circles[0].radius == 100);

  REQUIRE(map.camera);
  CHECK(*map.camera == ngn::MapCamera{{51.5, -0.1}, 12});
  CHECK(map.myLocation);
  CHECK(map.type == ngn::MapType::Hybrid);
  CHECK(map.traffic);
  CHECK_FALSE(map.selection);
  CHECK(map.polylineTapThreshold == 50);
  CHECK(map.realisticElevation);
  CHECK(map.mutedEmphasis);
  CHECK(map.pointsIncluding == std::vector<std::string>{"MKPOICategoryMuseum", "MKPOICategoryEVCharger"});
  CHECK_FALSE(map.pointsExcluding);
  CHECK_FALSE(map.compass);
  CHECK(map.scaleBar);
  CHECK_FALSE(map.pitchToggle);
  CHECK(map.colorScheme == ngn::MapColorScheme::Light);
  CHECK(ngn::mapModel(dynamic::object("properties", dynamic::object("mapType", "IMAGERY"))).type == ngn::MapType::Imagery);
  CHECK(ngn::mapModel(dynamic::object("colorScheme", "DARK")).colorScheme == ngn::MapColorScheme::Dark);
}

TEST_CASE("a changed list of markers or shapes reads as changed, and the same list as the same") {
  auto markers = dynamic::array(dynamic::object("id", "a")("coordinates", at(1, 1)));
  auto a = ngn::mapModel(dynamic::object("markers", markers));
  auto b = ngn::mapModel(dynamic::object("markers", markers)("colorScheme", "DARK"));
  auto c = ngn::mapModel(dynamic::object("markers", dynamic::array(dynamic::object("id", "a")("coordinates", at(1, 2)))));
  CHECK(a.givenMarkers == b.givenMarkers);
  CHECK(a.givenMarkers != c.givenMarkers);
  auto line = ngn::mapModel(dynamic::object("polylines", dynamic::array(dynamic::object("coordinates", dynamic::array(at(0, 0), at(1, 1))))));
  CHECK(a.givenShapes != line.givenShapes);
}

TEST_CASE("mapColor takes processed numbers, hex in four lengths and CSS names, and nothing else") {
  CHECK(ngn::mapColor(dynamic(0xff102030u)) == 0xff102030u);
  // A processed colour can arrive as a signed 32-bit number.
  CHECK(ngn::mapColor(dynamic(-16777216)) == 0xff000000u);
  CHECK(ngn::mapColor("#f00") == 0xffff0000u);
  CHECK(ngn::mapColor("#f008") == 0x88ff0000u);
  CHECK(ngn::mapColor("#336699") == 0xff336699u);
  CHECK(ngn::mapColor("#33669980") == 0x80336699u);
  CHECK(ngn::mapColor("green") == 0xff008000u);
  CHECK(ngn::mapColor("Blue") == 0xff0000ffu);
  CHECK(ngn::mapColor("transparent") == 0x00000000u);
  CHECK_FALSE(ngn::mapColor("#12"));
  CHECK_FALSE(ngn::mapColor("not-a-colour"));
  CHECK_FALSE(ngn::mapColor(nullptr));
}

TEST_CASE("mapPointOfInterestCategory names MapKit's category, with its capitalised initialisms") {
  CHECK(ngn::mapPointOfInterestCategory("MUSEUM") == "MKPOICategoryMuseum");
  CHECK(ngn::mapPointOfInterestCategory("MUSIC_VENUE") == "MKPOICategoryMusicVenue");
  CHECK(ngn::mapPointOfInterestCategory("EV_CHARGER") == "MKPOICategoryEVCharger");
  CHECK(ngn::mapPointOfInterestCategory("ATM") == "MKPOICategoryATM");
  CHECK(ngn::mapPointOfInterestCategory("RV_PARK") == "MKPOICategoryRVPark");
}

TEST_CASE("the zoom is expo-maps' span, 360 / 2^zoom degrees, and back") {
  auto span = ngn::mapSpanForZoom(4);
  CHECK(span.longitudeDelta == doctest::Approx(22.5));
  CHECK(span.latitudeDelta == doctest::Approx(22.5));
  CHECK(ngn::mapZoomForSpan(22.5) == doctest::Approx(4));
  // MapKit takes no more than 180 degrees of latitude.
  CHECK(ngn::mapSpanForZoom(0).latitudeDelta == 180);
  CHECK(ngn::mapSpanForZoom(0).longitudeDelta == 360);
}

TEST_CASE("mapCameraOf needs coordinates, and takes expo's zoom of 1 without one") {
  CHECK_FALSE(ngn::mapCameraOf(nullptr));
  CHECK_FALSE(ngn::mapCameraOf(dynamic::object("zoom", 3)));
  CHECK(ngn::mapCameraOf(dynamic::object("coordinates", at(10, 20))) == ngn::MapCamera{{10, 20}, 1});
}

TEST_CASE("mapDistance is metres along the surface, and a great circle bends towards the pole") {
  // One degree of latitude is about 111.2 km.
  CHECK(ngn::mapDistance({0, 0}, {1, 0}) == doctest::Approx(111195).epsilon(0.001));
  auto arc = ngn::mapGreatCircle({50, -100}, {50, 100}, 10);
  REQUIRE(arc.size() == 11);
  CHECK(arc.front().latitude == doctest::Approx(50));
  CHECK(arc.back().longitude == doctest::Approx(100));
  CHECK(arc[5].latitude > 80);
}

TEST_CASE("a click lands on a polygon, then a circle, then a polyline, and on the map where it misses them all") {
  auto map = ngn::mapModel(dynamic::object(
      "polygons", dynamic::array(dynamic::object("id", "square")("coordinates", dynamic::array(at(0, 0), at(0, 1), at(1, 1), at(1, 0)))(
                                     "color", 0xff0000ffu)("lineWidth", 2)))(
      "circles", dynamic::array(dynamic::object("id", "ring")("center", at(10, 10))("radius", 1000)("color", 0xff00ff00u)))(
      "polylines", dynamic::array(dynamic::object("id", "route")("coordinates", dynamic::array(at(20, 0), at(20, 1)))("width", 5)("color", "#123456"))));

  auto polygon = ngn::mapClickAt(map, {0.5, 0.5});
  CHECK(polygon.name == "polygonClick");
  CHECK(polygon.payload["id"] == "square");
  CHECK(polygon.payload["color"] == 0xff0000ffu);
  CHECK(polygon.payload["lineColor"] == nullptr);
  CHECK(polygon.payload["lineWidth"] == 2);
  CHECK(polygon.payload["coordinates"][2] == at(1, 1));

  auto circle = ngn::mapClickAt(map, {10.005, 10});
  CHECK(circle.name == "circleClick");
  CHECK(circle.payload["id"] == "ring");
  CHECK(circle.payload["radius"] == 1000);
  CHECK(circle.payload["coordinates"] == at(10, 10));
  CHECK(ngn::mapClickAt(map, {10.02, 10}).name == "mapClick");

  // 10 metres off the line, then about 110.
  auto line = ngn::mapClickAt(map, {20.00009, 0.5});
  CHECK(line.name == "polylineClick");
  CHECK(line.payload["id"] == "route");
  CHECK(line.payload["width"] == 5);
  CHECK(line.payload["color"] == "#123456");
  CHECK(line.payload["contourStyle"] == "STRAIGHT");
  CHECK(ngn::mapClickAt(map, {20.001, 0.5}).name == "mapClick");

  auto miss = ngn::mapClickAt(map, {-30, 40});
  CHECK(miss.name == "mapClick");
  CHECK(miss.payload == dynamic::object("coordinates", at(-30, 40)));

  // A polygon over a circle takes the click.
  auto stacked = ngn::mapModel(dynamic::object(
      "polygons", dynamic::array(dynamic::object("id", "p")("coordinates", dynamic::array(at(-1, -1), at(-1, 1), at(1, 1), at(1, -1)))))(
      "circles", dynamic::array(dynamic::object("id", "c")("center", at(0, 0))("radius", 1000))));
  CHECK(ngn::mapClickAt(stacked, {0, 0}).name == "polygonClick");
}

TEST_CASE("a geodesic polyline is hit along its curve, and its threshold is the properties'") {
  dynamic line = dynamic::object("id", "g")("coordinates", dynamic::array(at(50, -100), at(50, 100)))("contourStyle", "GEODESIC");
  auto map = ngn::mapModel(dynamic::object("polylines", dynamic::array(line)));
  auto top = ngn::mapGreatCircle({50, -100}, {50, 100}, 30)[15];
  CHECK(ngn::mapClickAt(map, top).name == "polylineClick");
  CHECK(ngn::mapClickAt(map, top).payload["contourStyle"] == "GEODESIC");
  // Straight, the same line is nowhere near the pole.
  line["contourStyle"] = "STRAIGHT";
  CHECK(ngn::mapClickAt(ngn::mapModel(dynamic::object("polylines", dynamic::array(line))), top).name == "mapClick");

  dynamic near = dynamic::object("polylines", dynamic::array(dynamic::object("coordinates", dynamic::array(at(0, 0), at(0, 1)))));
  CHECK(ngn::mapClickAt(ngn::mapModel(near), {0.0003, 0.5}).name == "mapClick");
  near["properties"] = dynamic::object("polylineTapThreshold", 50);
  CHECK(ngn::mapClickAt(ngn::mapModel(near), {0.0003, 0.5}).name == "polylineClick");
}

TEST_CASE("a marker's click and a camera move carry the iOS view's payloads") {
  auto map = ngn::mapModel(dynamic::object(
      "markers", dynamic::array(dynamic::object("id", "kx")("coordinates", at(51.53, -0.12))("title", "King's Cross")("tintColor", "#ff5a36"))));
  auto click = ngn::mapMarkerClick(map.markers[0]);
  CHECK(click.name == "markerClick");
  CHECK(click.payload ==
        dynamic::object("id", "kx")("title", "King's Cross")("tintColor", "#ff5a36")("systemImage", "")("monogram", "")(
            "coordinates", at(51.53, -0.12)));

  auto move = ngn::mapCameraMove({51.5, -0.1}, ngn::mapSpanForZoom(10), 30, 90);
  CHECK(move.name == "cameraMove");
  CHECK(move.payload["coordinates"] == at(51.5, -0.1));
  CHECK(move.payload["zoom"].asDouble() == doctest::Approx(10));
  CHECK(move.payload["longitudeDelta"].asDouble() == doctest::Approx(360.0 / 1024));
  CHECK(move.payload["latitudeDelta"].asDouble() == doctest::Approx(360.0 / 1024));
  CHECK(move.payload["tilt"] == 30.0);
  CHECK(move.payload["bearing"] == 90.0);
}

TEST_CASE("the map shows the user's location only when asked for and allowed, never asking itself") {
  auto asked = ngn::mapModel(dynamic::object("properties", dynamic::object("isMyLocationEnabled", true)));
  CHECK(ngn::mapShowsUserLocation(asked, Authorization::Granted));
  CHECK_FALSE(ngn::mapShowsUserLocation(asked, Authorization::Denied));
  CHECK_FALSE(ngn::mapShowsUserLocation(asked, Authorization::Restricted));
  CHECK_FALSE(ngn::mapShowsUserLocation(asked, Authorization::NotDetermined));
  CHECK_FALSE(ngn::mapShowsUserLocation(ngn::mapModel(dynamic::object()), Authorization::Granted));
}

TEST_CASE("NgNativeMaps calls the map's functions by the view's tag") {
  auto views = std::make_shared<ngn::MapViews>();
  auto map = std::make_shared<FakeMap>();
  views->attach(4, map);
  auto module = ngn::makeMapsModule(views);

  CHECK(call(*module, "setCameraPosition", dynamic::array(4, dynamic::object("coordinates", at(10, 20))("zoom", 8))).value);
  CHECK(call(*module, "setCameraPosition", dynamic::array(4, nullptr)).value);
  CHECK(call(*module, "selectMarker", dynamic::array(4, "kx", dynamic::object("zoom", 15))).value);
  CHECK(call(*module, "selectMarker", dynamic::array(4, "kx", dynamic::object("moveCamera", false))).value);
  CHECK(call(*module, "selectMarker", dynamic::array(4, nullptr, nullptr)).value);
  CHECK(map->calls == std::vector<std::string>{"camera 10.000000 8.000000", "camera user", "select kx 15.000000 move", "select kx - stay", "select none - move"});

  CHECK(call(*module, "setCameraPosition", dynamic::array(5, nullptr)).error == "Unable to find the map view with tag 5");
  views->detach(4);
  CHECK(call(*module, "selectMarker", dynamic::array(4, "kx", nullptr)).error);
}
