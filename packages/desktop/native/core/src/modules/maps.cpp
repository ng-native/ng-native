#include "ngn/maps.h"

#include "ngn/crypto.h"
#include "ngn/desktop-view-props.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <random>
#include <string_view>
#include <unordered_map>

using namespace facebook::react;
using folly::dynamic;

namespace ngn {

const char MapComponentName[] = "ViewManagerAdapter_ExpoAppleMaps";

MapProps::MapProps(const PropsParserContext &context, const MapProps &sourceProps, const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      HasDesktopProps{parseDesktopProps(context, sourceProps.desktop, rawProps)},
      values(sourceProps.values) {
  auto raw = rawProps.toDynamic();
  if (!raw.isObject()) {
    return;
  }
  for (const auto &[key, value] : raw.items()) {
    if (value.isNull()) {
      values.erase(key);
    } else {
      values[key] = value;
    }
  }
}

namespace {

constexpr double kPi = 3.14159265358979323846;
// The mean radius, in metres.
constexpr double kEarthRadius = 6371008.8;

const dynamic &field(const dynamic &object, const char *key) {
  static const dynamic none;
  if (!object.isObject()) {
    return none;
  }
  const auto *found = object.get_ptr(key);
  return found ? *found : none;
}

double number(const dynamic &object, const char *key, double otherwise) {
  const auto &value = field(object, key);
  return value.isNumber() ? value.asDouble() : otherwise;
}

bool flag(const dynamic &object, const char *key, bool otherwise) {
  const auto &value = field(object, key);
  return value.isBool() ? value.asBool() : otherwise;
}

std::string text(const dynamic &object, const char *key) {
  const auto &value = field(object, key);
  return value.isString() ? value.asString() : "";
}

std::optional<double> optionalNumber(const dynamic &object, const char *key) {
  const auto &value = field(object, key);
  return value.isNumber() ? std::optional(value.asDouble()) : std::nullopt;
}

MapCoordinate coordinateOf(const dynamic &value) {
  return {number(value, "latitude", 0), number(value, "longitude", 0)};
}

std::vector<MapCoordinate> coordinatesOf(const dynamic &value) {
  std::vector<MapCoordinate> out;
  if (value.isArray()) {
    for (const auto &one : value) {
      out.push_back(coordinateOf(one));
    }
  }
  return out;
}

dynamic coordinateValue(MapCoordinate coordinate) {
  return dynamic::object("latitude", coordinate.latitude)("longitude", coordinate.longitude);
}

dynamic coordinatesValue(const std::vector<MapCoordinate> &coordinates) {
  dynamic out = dynamic::array();
  for (const auto &one : coordinates) {
    out.push_back(coordinateValue(one));
  }
  return out;
}

// What an item with no id is called: a new UUID each time, as on iOS.
std::string newId() {
  static std::mutex mutex;
  static std::random_device device;
  std::lock_guard lock(mutex);
  std::string bytes(16, '\0');
  for (auto &byte : bytes) {
    byte = static_cast<char>(device() & 0xff);
  }
  return uuidV4(bytes);
}

std::string idOf(const dynamic &object) {
  auto id = text(object, "id");
  return id.empty() ? newId() : id;
}

const dynamic &givenColor(const dynamic &object, const char *key) {
  return field(object, key);
}

dynamic orNull(const dynamic &value) {
  return value.isNull() ? dynamic(nullptr) : value;
}

std::optional<std::vector<std::string>> categories(const dynamic &value) {
  if (!value.isArray()) {
    return std::nullopt;
  }
  std::vector<std::string> out;
  for (const auto &one : value) {
    if (one.isString()) {
      out.push_back(mapPointOfInterestCategory(one.asString()));
    }
  }
  return out;
}

// Web Mercator, as MKMapPoint is, with both axes 0 to 1.
struct Projected {
  double x;
  double y;
};

Projected project(MapCoordinate c) {
  double latitude = std::clamp(c.latitude, -85.0511287798, 85.0511287798) * kPi / 180;
  return {(c.longitude + 180) / 360, (1 - std::log(std::tan(latitude) + 1 / std::cos(latitude)) / kPi) / 2};
}

MapCoordinate unproject(Projected p) {
  return {std::atan(std::sinh(kPi * (1 - 2 * p.y))) * 180 / kPi, p.x * 360 - 180};
}

// Metres from `tap` to the segment from `a` to `b`, the projection taken on the flat map, as
// expo-maps measures it with MKMapPoints.
double distanceToSegment(MapCoordinate tap, MapCoordinate a, MapCoordinate b) {
  auto p = project(tap);
  auto pa = project(a);
  auto pb = project(b);
  double dx = pb.x - pa.x;
  double dy = pb.y - pa.y;
  if (dx == 0 && dy == 0) {
    return mapDistance(tap, a);
  }
  double t = std::clamp(((p.x - pa.x) * dx + (p.y - pa.y) * dy) / (dx * dx + dy * dy), 0.0, 1.0);
  return mapDistance(tap, unproject({pa.x + t * dx, pa.y + t * dy}));
}

bool insidePolygon(MapCoordinate tap, const std::vector<MapCoordinate> &corners) {
  bool inside = false;
  size_t n = corners.size();
  for (size_t i = 0, j = n - 1; i < n; j = i++) {
    const auto &vi = corners[i];
    const auto &vj = corners[j];
    if ((vi.latitude > tap.latitude) != (vj.latitude > tap.latitude) &&
        tap.longitude < (vj.longitude - vi.longitude) * (tap.latitude - vi.latitude) / (vj.latitude - vi.latitude) + vi.longitude) {
      inside = !inside;
    }
  }
  return inside;
}

bool onPolyline(MapCoordinate tap, const MapPolyline &line, double threshold) {
  std::vector<MapCoordinate> points;
  if (line.geodesic) {
    for (size_t i = 0; i + 1 < line.coordinates.size(); i++) {
      auto arc = mapGreatCircle(line.coordinates[i], line.coordinates[i + 1]);
      points.insert(points.end(), arc.begin(), arc.end() - 1);
    }
    if (!line.coordinates.empty()) {
      points.push_back(line.coordinates.back());
    }
  } else {
    points = line.coordinates;
  }
  for (size_t i = 0; i + 1 < points.size(); i++) {
    if (distanceToSegment(tap, points[i], points[i + 1]) < threshold) {
      return true;
    }
  }
  return false;
}

const std::unordered_map<std::string, uint32_t> &namedColors() {
  static const std::unordered_map<std::string, uint32_t> colors{
      {"transparent", 0x00000000}, {"black", 0xff000000},  {"white", 0xffffffff},  {"red", 0xffff0000},
      {"green", 0xff008000},       {"blue", 0xff0000ff},   {"yellow", 0xffffff00}, {"orange", 0xffffa500},
      {"purple", 0xff800080},      {"pink", 0xffffc0cb},   {"gray", 0xff808080},   {"grey", 0xff808080},
      {"brown", 0xffa52a2a},       {"cyan", 0xff00ffff},   {"magenta", 0xffff00ff}, {"lime", 0xff00ff00},
      {"navy", 0xff000080},        {"teal", 0xff008080},   {"maroon", 0xff800000}, {"olive", 0xff808000},
      {"silver", 0xffc0c0c0},      {"aqua", 0xff00ffff},   {"fuchsia", 0xffff00ff},
  };
  return colors;
}

} // namespace

std::optional<uint32_t> mapColor(const dynamic &value) {
  if (value.isNumber()) {
    return static_cast<uint32_t>(static_cast<int64_t>(value.asDouble()));
  }
  if (!value.isString()) {
    return std::nullopt;
  }
  std::string text = value.asString();
  std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) { return std::tolower(c); });
  if (auto named = namedColors().find(text); named != namedColors().end()) {
    return named->second;
  }
  if (text.empty() || text[0] != '#') {
    return std::nullopt;
  }
  std::string hex = text.substr(1);
  if (hex.empty() || !std::all_of(hex.begin(), hex.end(), [](unsigned char c) { return std::isxdigit(c); })) {
    return std::nullopt;
  }
  if (hex.size() == 3 || hex.size() == 4) {
    std::string wide;
    for (char c : hex) {
      wide += std::string(2, c);
    }
    hex = wide;
  }
  if (hex.size() != 6 && hex.size() != 8) {
    return std::nullopt;
  }
  auto rgba = static_cast<uint32_t>(std::stoul(hex, nullptr, 16));
  if (hex.size() == 6) {
    return 0xff000000u | rgba;
  }
  return (rgba >> 8) | ((rgba & 0xff) << 24);
}

std::string mapPointOfInterestCategory(const std::string &expoName) {
  static const std::unordered_map<std::string, std::string> initialisms{{"EV", "EV"}, {"ATM", "ATM"}, {"RV", "RV"}};
  std::string out = "MKPOICategory";
  size_t start = 0;
  while (start <= expoName.size()) {
    size_t end = expoName.find('_', start);
    if (end == std::string::npos) {
      end = expoName.size();
    }
    std::string word = expoName.substr(start, end - start);
    if (auto kept = initialisms.find(word); kept != initialisms.end()) {
      out += kept->second;
    } else if (!word.empty()) {
      out += static_cast<char>(std::toupper(static_cast<unsigned char>(word[0])));
      for (size_t i = 1; i < word.size(); i++) {
        out += static_cast<char>(std::tolower(static_cast<unsigned char>(word[i])));
      }
    }
    start = end + 1;
  }
  return out;
}

MapSpan mapSpanForZoom(double zoom) {
  double longitude = std::min(360 / std::pow(2.0, zoom), 360.0);
  return {std::min(longitude, 180.0), longitude};
}

double mapZoomForSpan(double longitudeDelta) {
  return std::log2(360 / longitudeDelta);
}

std::optional<MapCamera> mapCameraOf(const dynamic &position) {
  const auto &coordinates = field(position, "coordinates");
  if (!coordinates.isObject()) {
    return std::nullopt;
  }
  return MapCamera{coordinateOf(coordinates), number(position, "zoom", 1)};
}

MapModel mapModel(const dynamic &props) {
  MapModel map;
  map.givenMarkers = field(props, "markers");
  map.givenShapes = dynamic::array(field(props, "polylines"), field(props, "polygons"), field(props, "circles"));
  if (map.givenMarkers.isArray()) {
    for (const auto &one : map.givenMarkers) {
      map.markers.push_back({
          .id = idOf(one),
          .coordinates = coordinateOf(field(one, "coordinates")),
          .title = text(one, "title"),
          .systemImage = text(one, "systemImage"),
          .monogram = text(one, "monogram"),
          .tint = mapColor(field(one, "tintColor")),
          .given = one,
      });
    }
  }
  if (const auto &lines = field(props, "polylines"); lines.isArray()) {
    for (const auto &one : lines) {
      map.polylines.push_back({
          .id = idOf(one),
          .coordinates = coordinatesOf(field(one, "coordinates")),
          .color = mapColor(field(one, "color")),
          .width = number(one, "width", 4),
          .geodesic = text(one, "contourStyle") == "GEODESIC",
          .given = one,
      });
    }
  }
  if (const auto &polygons = field(props, "polygons"); polygons.isArray()) {
    for (const auto &one : polygons) {
      map.polygons.push_back({
          .id = idOf(one),
          .coordinates = coordinatesOf(field(one, "coordinates")),
          .color = mapColor(field(one, "color")),
          .lineColor = mapColor(field(one, "lineColor")),
          .lineWidth = number(one, "lineWidth", 0),
          .given = one,
      });
    }
  }
  if (const auto &circles = field(props, "circles"); circles.isArray()) {
    for (const auto &one : circles) {
      map.circles.push_back({
          .id = idOf(one),
          .center = coordinateOf(field(one, "center")),
          .radius = number(one, "radius", 0),
          .color = mapColor(field(one, "color")),
          .lineColor = mapColor(field(one, "lineColor")),
          .lineWidth = number(one, "lineWidth", 0),
          .given = one,
      });
    }
  }
  map.camera = mapCameraOf(field(props, "cameraPosition"));

  const auto &properties = field(props, "properties");
  map.myLocation = flag(properties, "isMyLocationEnabled", false);
  auto type = text(properties, "mapType");
  map.type = type == "HYBRID" ? MapType::Hybrid : type == "IMAGERY" ? MapType::Imagery : MapType::Standard;
  map.traffic = flag(properties, "isTrafficEnabled", false);
  map.selection = flag(properties, "selectionEnabled", true);
  map.polylineTapThreshold = number(properties, "polylineTapThreshold", 20);
  map.realisticElevation = text(properties, "elevation") == "REALISTIC";
  map.mutedEmphasis = text(properties, "emphasis") == "MUTED";
  const auto &points = field(properties, "pointsOfInterest");
  map.pointsIncluding = categories(field(points, "including"));
  if (!map.pointsIncluding) {
    map.pointsExcluding = categories(field(points, "excluding"));
  }

  const auto &ui = field(props, "uiSettings");
  map.compass = flag(ui, "compassEnabled", true);
  map.scaleBar = flag(ui, "scaleBarEnabled", false);
  map.pitchToggle = flag(ui, "togglePitchEnabled", true);
  map.userLocationButton = flag(ui, "myLocationButtonEnabled", true);

  auto scheme = text(props, "colorScheme");
  map.colorScheme = scheme == "LIGHT" ? MapColorScheme::Light : scheme == "DARK" ? MapColorScheme::Dark : MapColorScheme::Automatic;
  return map;
}

double mapDistance(MapCoordinate a, MapCoordinate b) {
  double la = a.latitude * kPi / 180;
  double lb = b.latitude * kPi / 180;
  double dLat = lb - la;
  double dLon = (b.longitude - a.longitude) * kPi / 180;
  double h = std::sin(dLat / 2) * std::sin(dLat / 2) + std::cos(la) * std::cos(lb) * std::sin(dLon / 2) * std::sin(dLon / 2);
  return 2 * kEarthRadius * std::asin(std::min(1.0, std::sqrt(h)));
}

std::vector<MapCoordinate> mapGreatCircle(MapCoordinate a, MapCoordinate b, int segments) {
  double lat1 = a.latitude * kPi / 180;
  double lon1 = a.longitude * kPi / 180;
  double lat2 = b.latitude * kPi / 180;
  double lon2 = b.longitude * kPi / 180;
  double d = std::acos(std::clamp(std::sin(lat1) * std::sin(lat2) + std::cos(lat1) * std::cos(lat2) * std::cos(lon2 - lon1), -1.0, 1.0));
  if (d <= 1e-10) {
    return {a, b};
  }
  std::vector<MapCoordinate> out;
  for (int i = 0; i <= segments; i++) {
    double f = static_cast<double>(i) / segments;
    double ka = std::sin((1 - f) * d) / std::sin(d);
    double kb = std::sin(f * d) / std::sin(d);
    double x = ka * std::cos(lat1) * std::cos(lon1) + kb * std::cos(lat2) * std::cos(lon2);
    double y = ka * std::cos(lat1) * std::sin(lon1) + kb * std::cos(lat2) * std::sin(lon2);
    double z = ka * std::sin(lat1) + kb * std::sin(lat2);
    out.push_back({std::atan2(z, std::sqrt(x * x + y * y)) * 180 / kPi, std::atan2(y, x) * 180 / kPi});
  }
  return out;
}

MapEvent mapClickAt(const MapModel &map, MapCoordinate tap) {
  for (const auto &polygon : map.polygons) {
    if (insidePolygon(tap, polygon.coordinates)) {
      return {"polygonClick",
              dynamic::object("id", polygon.id)("color", orNull(givenColor(polygon.given, "color")))(
                  "lineColor", orNull(givenColor(polygon.given, "lineColor")))("lineWidth", optionalNumber(polygon.given, "lineWidth") ? dynamic(polygon.lineWidth) : dynamic(nullptr))(
                  "coordinates", coordinatesValue(polygon.coordinates))};
    }
  }
  for (const auto &circle : map.circles) {
    if (mapDistance(tap, circle.center) <= circle.radius) {
      return {"circleClick",
              dynamic::object("id", circle.id)("color", orNull(givenColor(circle.given, "color")))(
                  "lineColor", orNull(givenColor(circle.given, "lineColor")))("lineWidth", optionalNumber(circle.given, "lineWidth") ? dynamic(circle.lineWidth) : dynamic(nullptr))(
                  "radius", circle.radius)("coordinates", coordinateValue(circle.center))};
    }
  }
  for (const auto &line : map.polylines) {
    if (onPolyline(tap, line, map.polylineTapThreshold)) {
      return {"polylineClick",
              dynamic::object("id", line.id)("color", orNull(givenColor(line.given, "color")))("width", line.width)(
                  "contourStyle", line.geodesic ? "GEODESIC" : "STRAIGHT")("coordinates", coordinatesValue(line.coordinates))};
    }
  }
  return {"mapClick", dynamic::object("coordinates", coordinateValue(tap))};
}

MapEvent mapMarkerClick(const MapMarker &marker) {
  return {"markerClick",
          dynamic::object("id", marker.id)("title", marker.title)("tintColor", orNull(givenColor(marker.given, "tintColor")))(
              "systemImage", marker.systemImage)("monogram", marker.monogram)("coordinates", coordinateValue(marker.coordinates))};
}

MapEvent mapCameraMove(MapCoordinate center, MapSpan span, double pitch, double heading) {
  return {"cameraMove",
          dynamic::object("coordinates", coordinateValue(center))("longitudeDelta", span.longitudeDelta)("latitudeDelta", span.latitudeDelta)(
              "zoom", mapZoomForSpan(span.longitudeDelta))("tilt", pitch)("bearing", heading)};
}

bool mapShowsUserLocation(const MapModel &map, LocationSource::Authorization authorization) {
  return map.myLocation && authorization == LocationSource::Authorization::Granted;
}

void MapViews::attach(int tag, std::shared_ptr<MapController> map) {
  std::lock_guard lock(mutex_);
  maps_[tag] = std::move(map);
}

void MapViews::detach(int tag) {
  std::lock_guard lock(mutex_);
  maps_.erase(tag);
}

std::shared_ptr<MapController> MapViews::find(int tag) const {
  std::lock_guard lock(mutex_);
  auto found = maps_.find(tag);
  return found == maps_.end() ? nullptr : found->second;
}

std::shared_ptr<NativeModule> makeMapsModule(std::shared_ptr<MapViews> views) {
  struct Maps : NativeModule {
    explicit Maps(std::shared_ptr<MapViews> views) : NativeModule("NgNativeMaps") {
      auto find = [views](const dynamic &args, JsPromise &promise) -> std::shared_ptr<MapController> {
        int tag = !args.empty() && args[0].isNumber() ? static_cast<int>(args[0].asDouble()) : -1;
        auto map = views->find(tag);
        if (!map) {
          promise.reject("Unable to find the map view with tag " + std::to_string(tag));
        }
        return map;
      };
      promise("setCameraPosition", [find](const dynamic &args, JsPromise promise) {
        auto map = find(args, promise);
        if (!map) {
          return;
        }
        map->setCamera(mapCameraOf(args.size() > 1 ? args[1] : dynamic(nullptr)));
        promise.resolve(nullptr);
      });
      promise("selectMarker", [find](const dynamic &args, JsPromise promise) {
        auto map = find(args, promise);
        if (!map) {
          return;
        }
        std::optional<std::string> id;
        if (args.size() > 1 && args[1].isString()) {
          id = args[1].asString();
        }
        const dynamic options = args.size() > 2 ? args[2] : dynamic(nullptr);
        map->selectMarker(id, optionalNumber(options, "zoom"), flag(options, "moveCamera", true));
        promise.resolve(nullptr);
      });
    }
  };
  return std::make_shared<Maps>(std::move(views));
}

} // namespace ngn
