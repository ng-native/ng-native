// Markers, patterns and filters in the core's SVG model (svg.h): what drawSvg asks the canvas for,
// and runSvgFilter's steps over pixels.
#include "ngn/svg.h"
#include "svg-recorder.h"

#include <doctest/doctest.h>

#include <algorithm>
#include <cmath>

using ngn::SvgBrush;
using ngn::SvgElement;
using ngn::SvgFilter;
using ngn::SvgFilterStep;
using ngn::SvgKind;
using ngn::SvgLength;
using ngn::SvgMarkerVertex;
using ngn::SvgMatrix;
using ngn::SvgNode;
using ngn::SvgPixels;

namespace {

SvgLength len(double v) {
  return {.value = v, .set = true};
}
SvgBrush color(uint32_t argb) {
  return {.type = SvgBrush::Type::Color, .argb = argb};
}
SvgBrush ref(std::string name) {
  return {.type = SvgBrush::Type::Ref, .ref = std::move(name)};
}
SvgNode node(SvgElement element, std::vector<SvgNode> children = {}) {
  return {.element = std::move(element), .children = std::move(children)};
}
SvgElement svg() {
  return {.kind = SvgKind::Svg};
}
SvgElement rect(double x, double y, double w, double h) {
  SvgElement e{.kind = SvgKind::Rect};
  e.lengths = {{"x", len(x)}, {"y", len(y)}, {"width", len(w)}, {"height", len(h)}};
  return e;
}
SvgElement path(std::string d) {
  SvgElement e{.kind = SvgKind::Path};
  e.d = std::move(d);
  return e;
}
SvgElement named(SvgKind kind, std::string name) {
  SvgElement e{.kind = kind};
  e.name = std::move(name);
  return e;
}

std::vector<std::string> draw(SvgNode root, double width = 40, double height = 40) {
  Recorder canvas;
  ngn::drawSvg({.root = std::move(root)}, width, height, canvas);
  return canvas.calls;
}

bool has(const std::vector<std::string> &calls, const std::string &call) {
  return std::find(calls.begin(), calls.end(), call) != calls.end();
}

std::string joined(const std::vector<std::string> &calls) {
  std::string out;
  for (const auto &c : calls) {
    out += c + "\n";
  }
  return out;
}

} // namespace

TEST_CASE("markers sit at a path's vertices, each turned along the path, the middle ones bisecting") {
  auto vertices = ngn::svgMarkerVertices(ngn::parseSvgPath("M0,0 L10,0 L10,10"));
  REQUIRE(vertices.size() == 3);
  CHECK(vertices[0] == SvgMarkerVertex{.place = SvgMarkerVertex::Place::Start, .x = 0, .y = 0, .angle = 0});
  CHECK(vertices[1].place == SvgMarkerVertex::Place::Mid);
  CHECK(vertices[1].x == 10);
  CHECK(vertices[1].angle == doctest::Approx(45));
  CHECK(vertices[2].place == SvgMarkerVertex::Place::End);
  CHECK(vertices[2].y == 10);
  CHECK(vertices[2].angle == doctest::Approx(90));

  // A curve's direction at an end is towards or from its nearer control point.
  auto curve = ngn::svgMarkerVertices(ngn::parseSvgPath("M0,0 C0,10 10,10 10,0"));
  REQUIRE(curve.size() == 2);
  CHECK(curve[0].angle == doctest::Approx(90));
  CHECK(curve[1].angle == doctest::Approx(-90));

  // A closed subpath ends where it started, and both its ends bisect the closing line and the
  // first segment.
  auto closed = ngn::svgMarkerVertices(ngn::parseSvgPath("M0,0 L10,0 L10,10 Z"));
  REQUIRE(closed.size() == 4);
  CHECK(closed[3].place == SvgMarkerVertex::Place::End);
  CHECK(closed[3].x == 0);
  CHECK(closed[3].y == 0);
  CHECK(closed[3].angle == doctest::Approx(-67.5));
  CHECK(closed[0].angle == doctest::Approx(-67.5));

  CHECK(ngn::svgMarkerVertices(ngn::SvgPath{}).empty());
}

TEST_CASE("a marker draws its content at the vertex, turned, scaled by the stroke width and fitted to its viewBox") {
  SvgElement arrow = named(SvgKind::Marker, "arrow");
  arrow.vbWidth = 10;
  arrow.vbHeight = 10;
  arrow.align = "xMidYMid";
  arrow.orient = "auto";
  arrow.lengths = {{"refX", len(5)}, {"refY", len(5)}, {"markerWidth", len(6)}, {"markerHeight", len(6)}};
  SvgElement head = path("M0,0 L10,5 L0,10 Z");
  head.fill = color(0xffff0000);
  SvgElement line = path("M0,10 L10,10 L10,20");
  line.stroke = color(0xff000000);
  line.strokeWidth = len(2);
  line.markerEnd = "arrow";
  line.markerStart = "arrow";
  auto calls = draw(node(svg(), {node(named(SvgKind::Defs, ""), {node(arrow, {node(head)})}), node(line)}));
  INFO(joined(calls));
  // The end: at (10, 20), turned 90 degrees, twice the size; the ref point (5, 5) of the viewBox,
  // (3, 3) of the 6 by 6 marker, on the vertex; the marker's box clips; the viewBox fits.
  CHECK(has(calls, "concat 0 2 -2 0 10 20"));
  CHECK(has(calls, "concat 1 0 0 1 -3 -3"));
  CHECK(has(calls, "clip M0,0L6,0L6,6L0,6Z"));
  CHECK(has(calls, "concat 0.6 0 0 0.6 0 0"));
  // The start: at (0, 10), not turned.
  CHECK(has(calls, "concat 2 0 0 2 0 10"));
  // The line first, then a head at each end; the middle vertex has no marker.
  auto stroke = std::find_if(calls.begin(), calls.end(), [](const std::string &c) { return c.starts_with("stroke"); });
  auto heads = std::count(calls.begin(), calls.end(), std::string("fill M0,0L10,5L0,10Z #ffff0000"));
  CHECK(heads == 2);
  CHECK(stroke < std::find(calls.begin(), calls.end(), std::string("fill M0,0L10,5L0,10Z #ffff0000")));
}

TEST_CASE("a marker's orient: auto-start-reverse turns the start around, an angle is fixed, and userSpaceOnUse ignores the stroke") {
  SvgElement m = named(SvgKind::Marker, "m");
  m.orient = "auto-start-reverse";
  SvgElement dot = rect(0, 0, 1, 1);
  SvgElement line = path("M0,0 L10,0");
  line.strokeWidth = len(3);
  line.markerStart = "m";
  auto calls = draw(node(svg(), {node(m, {node(dot)}), node(line)}));
  INFO(joined(calls));
  CHECK(has(calls, "concat -3 0 0 -3 0 0"));

  m.orient = "30";
  m.markerUnits = "userSpaceOnUse";
  calls = draw(node(svg(), {node(m, {node(dot)}), node(line)}));
  INFO(joined(calls));
  CHECK(has(calls, "concat 0.87 0.5 -0.5 0.87 0 0"));
  // markerWidth and markerHeight default to 3.
  CHECK(has(calls, "clip M0,0L3,0L3,3L0,3Z"));
}

TEST_CASE("a marker that refers to itself through its content draws once rather than recursing") {
  SvgElement m = named(SvgKind::Marker, "m");
  SvgElement inner = path("M0,0 L1,1");
  inner.markerEnd = "m";
  SvgElement line = path("M0,0 L10,0");
  line.markerEnd = "m";
  auto calls = draw(node(svg(), {node(m, {node(inner)}), node(line)}));
  CHECK(std::count_if(calls.begin(), calls.end(), [](const std::string &c) { return c.starts_with("clip M0,0L3"); }) == 1);
}

TEST_CASE("a pattern fills a shape with its tile in user space, its content drawn once for the tile") {
  SvgElement p = named(SvgKind::Pattern, "dots");
  p.units = 1;
  p.lengths = {{"x", len(2)}, {"y", len(4)}, {"width", len(10)}, {"height", len(8)}};
  SvgElement dot = rect(0, 0, 5, 5);
  dot.fill = color(0xffff0000);
  SvgElement shape = rect(0, 0, 30, 20);
  shape.fill = ref("dots");
  shape.fillOpacity = 0.5;
  auto calls = draw(node(svg(), {node(p, {node(dot)}), node(shape)}));
  INFO(joined(calls));
  CHECK(has(calls, "clip M0,0L30,0L30,20L0,20Z"));
  CHECK(has(calls, "pattern 2,4 10x8 t1,0,0,1,0,0 @0.5"));
  auto tile = std::find(calls.begin(), calls.end(), std::string("tile"));
  REQUIRE(tile != calls.end());
  CHECK(*(tile + 1) == "fill M0,0L5,0L5,5L0,5Z #ffff0000");
  CHECK(*(tile + 2) == "end tile");
}

TEST_CASE("a pattern in objectBoundingBox units spans fractions of the shape, with its content units and transform") {
  SvgElement p = named(SvgKind::Pattern, "checks");
  p.units = 0;
  p.contentUnits = 0;
  p.lengths = {{"width", len(0.5)}, {"height", len(0.25)}};
  p.gradientTransform = SvgMatrix{1, 0, 0, 1, 3, 0};
  SvgElement square = rect(0, 0, 0.5, 0.5);
  SvgElement shape = rect(10, 10, 20, 40);
  shape.stroke = ref("checks");
  shape.fill = SvgBrush{.type = SvgBrush::Type::None};
  shape.strokeWidth = len(4);
  auto calls = draw(node(svg(), {node(p, {node(square)}), node(shape)}));
  INFO(joined(calls));
  // A stroke clips to its own outline.
  CHECK(has(calls, "clip stroke M10,10L30,10L30,50L10,50Z w4"));
  CHECK(has(calls, "pattern 10,10 10x10 t1,0,0,1,3,0"));
  // Content in fractions of the box.
  CHECK(has(calls, "concat 20 0 0 40 0 0"));
}

TEST_CASE("a pattern with no width, or one a reference cannot find, paints nothing") {
  SvgElement p = named(SvgKind::Pattern, "empty");
  p.units = 1;
  SvgElement shape = rect(0, 0, 10, 10);
  shape.fill = ref("empty");
  auto calls = draw(node(svg(), {node(p, {node(rect(0, 0, 1, 1))}), node(shape)}));
  CHECK(std::none_of(calls.begin(), calls.end(), [](const std::string &c) { return c.starts_with("pattern") || c.starts_with("fill"); }));
}

namespace {

SvgElement step(SvgKind kind, std::string in1 = "", std::string result = "") {
  SvgElement e{.kind = kind};
  e.in1 = std::move(in1);
  e.result = std::move(result);
  return e;
}

} // namespace

TEST_CASE("a filter: a drop shadow's steps over the element, in its region and primitive units") {
  SvgElement f = named(SvgKind::Filter, "shadow");
  f.units = 0; // objectBoundingBox, the default region a tenth over each side
  f.contentUnits = 0; // primitiveUnits objectBoundingBox
  SvgElement blur = step(SvgKind::FeGaussianBlur, "SourceAlpha");
  blur.stdDeviationX = 0.1;
  blur.stdDeviationY = 0.05;
  SvgElement offset = step(SvgKind::FeOffset, "", "moved");
  offset.lengths = {{"dx", len(0.1)}, {"dy", len(0.2)}};
  SvgElement flood = step(SvgKind::FeFlood);
  flood.flood = color(0xff112233);
  flood.floodOpacity = 0.5;
  SvgElement composite = step(SvgKind::FeComposite);
  composite.in2 = "moved";
  composite.op = 1;
  SvgElement merge = step(SvgKind::FeMerge);
  merge.nodes = {"", "SourceGraphic"};
  SvgElement shape = rect(0, 0, 20, 10);
  shape.filter = "shadow";
  auto calls = draw(node(svg(), {node(f, {node(blur), node(offset), node(flood), node(composite), node(merge)}), node(shape)}));
  INFO(joined(calls));
  CHECK(has(
      calls,
      "filter -2,-1 24x12"
      " blur(SourceAlpha 2,0.5 in -2,-1 24x12 >#0)"
      " offset(#0 2,2 in -2,-1 24x12 >moved)"
      " flood(#ff112233 0.5 in -2,-1 24x12 >#2)"
      " composite(#2 moved op1 in -2,-1 24x12 >#3)"
      " merge(#3 SourceGraphic in -2,-1 24x12 >#4)"));
  auto begin = std::find_if(calls.begin(), calls.end(), [](const std::string &c) { return c.starts_with("filter"); });
  REQUIRE(begin != calls.end());
  CHECK(*(begin + 1) == "fill M0,0L20,0L20,10L0,10Z #ff000000");
  CHECK(*(begin + 2) == "end filter");
}

TEST_CASE("a filter's region and a step's subregion in user space, and a filter with no steps or none found") {
  SvgElement f = named(SvgKind::Filter, "f");
  f.units = 1;
  f.lengths = {{"x", len(1)}, {"y", len(2)}, {"width", len(30)}, {"height", len(20)}};
  SvgElement flood = step(SvgKind::FeFlood);
  flood.lengths = {{"x", len(5)}, {"width", len(10)}};
  SvgElement shape = rect(0, 0, 10, 10);
  shape.filter = "f";
  auto calls = draw(node(svg(), {node(f, {node(flood)}), node(shape)}));
  INFO(joined(calls));
  CHECK(has(calls, "filter 1,2 30x20 flood(#ff000000 1 in 5,2 10x20 >#0)"));

  // An empty filter draws the element as nothing, as SVG says; a missing one draws it plainly.
  calls = draw(node(svg(), {node(named(SvgKind::Filter, "f")), node(shape)}));
  CHECK(std::none_of(calls.begin(), calls.end(), [](const std::string &c) { return c.starts_with("fill"); }));
  shape.filter = "nothing";
  calls = draw(node(svg(), {node(shape)}));
  CHECK(std::count_if(calls.begin(), calls.end(), [](const std::string &c) { return c.starts_with("fill"); }) == 1);
  CHECK(std::none_of(calls.begin(), calls.end(), [](const std::string &c) { return c.starts_with("filter"); }));
}

TEST_CASE("a colour matrix's types as SVG defines them") {
  auto identity = ngn::svgColorMatrix(0, {});
  CHECK(identity[0] == 1);
  CHECK(identity[6] == 1);
  CHECK(identity[12] == 1);
  CHECK(identity[18] == 1);
  CHECK(identity[4] == 0);
  std::vector<double> values(20, 0.5);
  CHECK(ngn::svgColorMatrix(0, values)[7] == 0.5);
  // saturate 0 is the luminance in each channel.
  auto grey = ngn::svgColorMatrix(1, {0});
  CHECK(grey[0] == doctest::Approx(0.213));
  CHECK(grey[1] == doctest::Approx(0.715));
  CHECK(grey[2] == doctest::Approx(0.072));
  CHECK(grey[5] == doctest::Approx(0.213));
  // saturate with no value is 1, the identity.
  CHECK(ngn::svgColorMatrix(1, {})[0] == doctest::Approx(1));
  // hueRotate 180.
  auto turned = ngn::svgColorMatrix(2, {180});
  CHECK(turned[0] == doctest::Approx(-0.574).epsilon(0.01));
  CHECK(turned[18] == 1);
  // luminanceToAlpha puts the luminance in alpha and zeroes the colour.
  auto alpha = ngn::svgColorMatrix(3, {});
  CHECK(alpha[0] == 0);
  CHECK(alpha[15] == doctest::Approx(0.2125));
  CHECK(alpha[16] == doctest::Approx(0.7154));
  CHECK(alpha[17] == doctest::Approx(0.0721));
  CHECK(alpha[18] == 0);
}

namespace {

SvgPixels pixels(int w, int h) {
  return {.width = w, .height = h, .rgba = std::vector<uint8_t>(static_cast<size_t>(w * h * 4), 0)};
}

void put(SvgPixels &p, int x, int y, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
  auto *px = &p.rgba[static_cast<size_t>((y * p.width + x) * 4)];
  px[0] = r;
  px[1] = g;
  px[2] = b;
  px[3] = a;
}

std::array<int, 4> at(const SvgPixels &p, int x, int y) {
  const auto *px = &p.rgba[static_cast<size_t>((y * p.width + x) * 4)];
  return {px[0], px[1], px[2], px[3]};
}

SvgFilterStep offsetStep(std::string in1, double dx, double dy, std::string result) {
  SvgFilterStep s{.type = SvgFilterStep::Type::Offset, .in1 = std::move(in1), .result = std::move(result)};
  s.dx = dx;
  s.dy = dy;
  s.subregion = {0, 0, 100, 100};
  return s;
}

SvgFilter filterOf(std::vector<SvgFilterStep> steps) {
  return {.region = {0, 0, 100, 100}, .steps = std::move(steps)};
}

} // namespace

TEST_CASE("runSvgFilter: an offset moves the pixels by its lengths through the transform") {
  auto source = pixels(8, 8);
  put(source, 1, 1, 255, 0, 0, 255);
  auto out = ngn::runSvgFilter(filterOf({offsetStep("SourceGraphic", 1, 2, "#0")}), source, SvgMatrix{});
  CHECK(at(out, 1, 1) == std::array<int, 4>{0, 0, 0, 0});
  CHECK(at(out, 2, 3) == std::array<int, 4>{255, 0, 0, 255});
  // At two pixels a unit it moves twice as far.
  out = ngn::runSvgFilter(filterOf({offsetStep("SourceGraphic", 1, 2, "#0")}), source, SvgMatrix::scale(2, 2));
  CHECK(at(out, 3, 5) == std::array<int, 4>{255, 0, 0, 255});
}

TEST_CASE("runSvgFilter: SourceAlpha, a flood and composite in make a shadow of the shape's own outline") {
  auto source = pixels(4, 4);
  put(source, 0, 0, 255, 0, 0, 255);
  put(source, 1, 0, 0, 0, 128, 128);
  SvgFilterStep alpha = offsetStep("SourceAlpha", 0, 0, "a");
  SvgFilterStep flood{.type = SvgFilterStep::Type::Flood, .in1 = "a", .result = "f"};
  flood.subregion = {0, 0, 100, 100};
  flood.argb = 0xff00ff00;
  flood.opacity = 0.5;
  SvgFilterStep in{.type = SvgFilterStep::Type::Composite, .in1 = "f", .in2 = "a", .result = "#2"};
  in.subregion = {0, 0, 100, 100};
  in.op = 1;
  auto out = ngn::runSvgFilter(filterOf({alpha, flood, in}), source, SvgMatrix{});
  CHECK(at(out, 0, 0) == std::array<int, 4>{0, 128, 0, 128});
  CHECK(at(out, 1, 0) == std::array<int, 4>{0, 64, 0, 64});
  CHECK(at(out, 2, 2) == std::array<int, 4>{0, 0, 0, 0});
}

TEST_CASE("runSvgFilter: a merge draws its inputs in order, each over the last") {
  auto source = pixels(2, 1);
  put(source, 0, 0, 255, 0, 0, 255);
  SvgFilterStep flood{.type = SvgFilterStep::Type::Flood, .in1 = "SourceGraphic", .result = "blue"};
  flood.subregion = {0, 0, 100, 100};
  flood.argb = 0xff0000ff;
  SvgFilterStep merge{.type = SvgFilterStep::Type::Merge, .in1 = "blue", .result = "#1"};
  merge.subregion = {0, 0, 100, 100};
  merge.inputs = {"blue", "SourceGraphic"};
  auto out = ngn::runSvgFilter(filterOf({flood, merge}), source, SvgMatrix{});
  CHECK(at(out, 0, 0) == std::array<int, 4>{255, 0, 0, 255});
  CHECK(at(out, 1, 0) == std::array<int, 4>{0, 0, 255, 255});
}

TEST_CASE("runSvgFilter: a blur spreads a pixel evenly both ways, keeping about its weight") {
  auto source = pixels(21, 21);
  put(source, 10, 10, 255, 255, 255, 255);
  SvgFilterStep blur{.type = SvgFilterStep::Type::GaussianBlur, .in1 = "SourceGraphic", .result = "#0"};
  blur.subregion = {0, 0, 100, 100};
  blur.stdDeviationX = 2;
  blur.stdDeviationY = 2;
  // Saturated, so the spread is visible in 8 bits.
  for (int y = 8; y <= 12; ++y) {
    for (int x = 8; x <= 12; ++x) {
      put(source, x, y, 255, 255, 255, 255);
    }
  }
  auto out = ngn::runSvgFilter(filterOf({blur}), source, SvgMatrix{});
  CHECK(at(out, 10, 10)[3] < 255);
  CHECK(at(out, 10, 10)[3] > 128);
  CHECK(at(out, 14, 10)[3] > 0);
  CHECK(at(out, 14, 10) == at(out, 6, 10));
  CHECK(at(out, 10, 14) == at(out, 10, 6));
  CHECK(at(out, 0, 0)[3] == 0);
  long total = 0;
  for (int i = 3; i < static_cast<int>(out.rgba.size()); i += 4) {
    total += out.rgba[static_cast<size_t>(i)];
  }
  CHECK(total == doctest::Approx(25 * 255).epsilon(0.05));
  // Only one way: no spread up and down.
  blur.stdDeviationY = 0;
  out = ngn::runSvgFilter(filterOf({blur}), source, SvgMatrix{});
  CHECK(at(out, 10, 14)[3] == 0);
  CHECK(at(out, 14, 10)[3] > 0);
}

TEST_CASE("runSvgFilter: a colour matrix works on unpremultiplied colour, and arithmetic adds") {
  auto source = pixels(2, 1);
  put(source, 0, 0, 128, 0, 0, 128); // half-transparent red
  SvgFilterStep grey{.type = SvgFilterStep::Type::ColorMatrix, .in1 = "SourceGraphic", .result = "#0"};
  grey.subregion = {0, 0, 100, 100};
  grey.matrix = ngn::svgColorMatrix(1, {0});
  auto out = ngn::runSvgFilter(filterOf({grey}), source, SvgMatrix{});
  // Red's luminance, 0.2126 of 255, at half alpha.
  CHECK(at(out, 0, 0)[0] == doctest::Approx(27).epsilon(0.1));
  CHECK(at(out, 0, 0)[1] == at(out, 0, 0)[0]);
  CHECK(at(out, 0, 0)[3] == 128);

  SvgFilterStep add{.type = SvgFilterStep::Type::Composite, .in1 = "SourceGraphic", .in2 = "SourceGraphic", .result = "#0"};
  add.subregion = {0, 0, 100, 100};
  add.op = 5;
  add.k = {0, 1, 1, 0};
  out = ngn::runSvgFilter(filterOf({add}), source, SvgMatrix{});
  CHECK(at(out, 0, 0) == std::array<int, 4>{255, 0, 0, 255});
}

TEST_CASE("runSvgFilter: a step draws only in its subregion, and the result only in the region") {
  auto source = pixels(10, 10);
  SvgFilterStep flood{.type = SvgFilterStep::Type::Flood, .in1 = "SourceGraphic", .result = "#0"};
  flood.subregion = {0, 0, 5, 10};
  flood.argb = 0xffffffff;
  auto out = ngn::runSvgFilter(filterOf({flood}), source, SvgMatrix{});
  CHECK(at(out, 4, 4)[3] == 255);
  CHECK(at(out, 5, 4)[3] == 0);
  SvgFilter f = filterOf({flood});
  f.region = {0, 0, 10, 2};
  out = ngn::runSvgFilter(f, source, SvgMatrix{});
  CHECK(at(out, 1, 1)[3] == 255);
  CHECK(at(out, 1, 2)[3] == 0);
  // A step that names an input nothing made reads it as transparent.
  out = ngn::runSvgFilter(filterOf({offsetStep("nowhere", 0, 0, "#0")}), source, SvgMatrix{});
  CHECK(at(out, 0, 0)[3] == 0);
}
