#include "helpers.h"
#include "ngn/svg.h"
#include "svg-recorder.h"

#include <doctest/doctest.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <sstream>

using namespace facebook::react;
using ngn::SvgBrush;
using ngn::SvgElement;
using ngn::SvgKind;
using ngn::SvgLength;
using ngn::SvgNode;
using ngn::SvgPath;
using Op = ngn::SvgPath::Op;

namespace {

SvgLength len(double v) {
  return {.value = v, .set = true};
}
SvgLength pct(double v) {
  return {.value = v, .unit = SvgLength::Unit::Percent, .set = true};
}
SvgBrush color(uint32_t argb) {
  return {.type = SvgBrush::Type::Color, .argb = argb};
}
SvgBrush none() {
  return {.type = SvgBrush::Type::None};
}

SvgNode node(SvgElement element, std::vector<SvgNode> children = {}) {
  return {.element = std::move(element), .children = std::move(children)};
}

SvgElement svg(double vbWidth = 0, double vbHeight = 0) {
  SvgElement e{.kind = SvgKind::Svg};
  e.vbWidth = vbWidth;
  e.vbHeight = vbHeight;
  e.align = "xMidYMid";
  return e;
}

SvgElement path(std::string d) {
  SvgElement e{.kind = SvgKind::Path};
  e.d = std::move(d);
  return e;
}

SvgElement rect(double x, double y, double w, double h) {
  SvgElement e{.kind = SvgKind::Rect};
  e.lengths = {{"x", len(x)}, {"y", len(y)}, {"width", len(w)}, {"height", len(h)}};
  return e;
}

std::vector<std::string> draw(SvgNode root, double width = 24, double height = 24) {
  Recorder canvas;
  ngn::drawSvg({.root = std::move(root)}, width, height, canvas);
  return canvas.calls;
}

std::vector<std::string> drawn(SvgNode root, double width = 24, double height = 24) {
  Recorder canvas;
  ngn::drawSvg({.root = std::move(root)}, width, height, canvas);
  return canvas.drawn();
}

} // namespace

TEST_CASE("path data: absolute and relative lines, horizontal and vertical, and closes") {
  CHECK(Recorder::path(ngn::parseSvgPath("M1 2L3 4H10V20Z")) == "M1,2L3,4L10,4L10,20Z");
  CHECK(Recorder::path(ngn::parseSvgPath("m1 2l3 4h10v-2z m5 5 1 1")) == "M1,2L4,6L14,6L14,4ZM6,7L7,8");
  // Numbers run together as SVG allows: a sign or a second point starts a new one.
  CHECK(Recorder::path(ngn::parseSvgPath("M1.5.5L-1-2")) == "M1.5,0.5L-1,-2");
  CHECK(Recorder::path(ngn::parseSvgPath("M1e1,2e-1 L3,4")) == "M10,0.2L3,4");
}

TEST_CASE("path data: after a close, a relative move starts from the subpath's start") {
  CHECK(Recorder::path(ngn::parseSvgPath("M10 10 l5 0 z l0 5")) == "M10,10L15,10ZM10,10L10,15");
}

TEST_CASE("path data: curves end where they say, and quadratics and smooth curves become cubics") {
  auto p = ngn::parseSvgPath("M0 0C1 1 2 2 3 3S5 5 6 6Q7 7 8 8T10 10");
  CHECK(Recorder::path(p) == "M0,0C3,3C6,6C8,8C10,10");
  // A quadratic's cubic controls sit two thirds of the way to its control point.
  auto q = ngn::parseSvgPath("M0 0Q3 3 6 0");
  REQUIRE(q.segments.size() == 2);
  CHECK(q.segments[1].points[0] == doctest::Approx(2));
  CHECK(q.segments[1].points[1] == doctest::Approx(2));
  CHECK(q.segments[1].points[2] == doctest::Approx(4));
  CHECK(q.segments[1].points[3] == doctest::Approx(2));
  // A smooth cubic reflects the previous control point.
  auto s = ngn::parseSvgPath("M0 0C0 1 1 2 2 2S4 1 4 0");
  CHECK(s.segments[2].points[0] == doctest::Approx(3));
  CHECK(s.segments[2].points[1] == doctest::Approx(2));
}

TEST_CASE("path data: an arc becomes cubics through its end, with radii scaled up when too small") {
  // A half circle of radius 5 from (0, 5) to (10, 5).
  auto half = ngn::parseSvgPath("M0 5A5 5 0 0 1 10 5");
  REQUIRE(half.segments.size() >= 2);
  const auto &last = half.segments.back();
  CHECK(last.op == Op::Cubic);
  CHECK(last.points[4] == doctest::Approx(10));
  CHECK(last.points[5] == doctest::Approx(5));
  // Sweep 1 goes clockwise on screen (y down), through the top: y reaches 0.
  auto bounds = half.bounds();
  REQUIRE(bounds);
  CHECK(bounds->y == doctest::Approx(0).epsilon(0.01));
  CHECK(bounds->y + bounds->height == doctest::Approx(5));
  // Radii of 1 cannot reach 10 apart: they scale to 5, the same half circle.
  CHECK(Recorder::path(ngn::parseSvgPath("M0 5a1 1 0 0 1 10 0")) == Recorder::path(half));
  // Flags may be written without separators, as icon sets minify them.
  CHECK(Recorder::path(ngn::parseSvgPath("M0 5a5 5 0 0110 0")) == Recorder::path(half));
  // A zero radius is a line.
  CHECK(Recorder::path(ngn::parseSvgPath("M0 0A0 5 0 0 1 10 5")) == "M0,0L10,5");
}

TEST_CASE("path data: drawing stops at the first error, keeping what came before") {
  CHECK(Recorder::path(ngn::parseSvgPath("M1 1L2 2X3 3L4 4")) == "M1,1L2,2");
  CHECK(Recorder::path(ngn::parseSvgPath("L2 2")).empty());
}

TEST_CASE("path data: a number after a close ends the path, rather than closing it again for ever") {
  CHECK(Recorder::path(ngn::parseSvgPath("M0 0L1 0Z 1")) == "M0,0L1,0Z");
  CHECK(Recorder::path(ngn::parseSvgPath("M0 0L1 0Z1 1L2 2")) == "M0,0L1,0Z");
  // A close then a command goes on as before.
  CHECK(Recorder::path(ngn::parseSvgPath("M0 0L1 0ZL2 2")) == "M0,0L1,0ZM0,0L2,2");
}

TEST_CASE("a path's bounds reach the curve's own extremes, not its control points") {
  auto bounds = ngn::parseSvgPath("M0 0C0 100 100 100 100 0").bounds();
  REQUIRE(bounds);
  CHECK(bounds->x == doctest::Approx(0));
  CHECK(bounds->width == doctest::Approx(100));
  CHECK(bounds->y == doctest::Approx(0));
  CHECK(bounds->height == doctest::Approx(75));
  // After a close, the next curve starts where the closed subpath did.
  auto closed = ngn::parseSvgPath("M10 10L20 10ZC10 -10 20 -10 20 10").bounds();
  REQUIRE(closed);
  CHECK(closed->y == doctest::Approx(-5));
}

TEST_CASE("a length is a number, a numeric string, a percentage or ems") {
  CHECK(ngn::svgLength(folly::dynamic(12)) == len(12));
  CHECK(ngn::svgLength(folly::dynamic("1.5")) == len(1.5));
  CHECK(ngn::svgLength(folly::dynamic("50%")) == pct(50));
  CHECK(ngn::svgLength(folly::dynamic("2em")) == SvgLength{.value = 2, .unit = SvgLength::Unit::Em, .set = true});
  CHECK(ngn::svgLength(folly::dynamic("3px")) == len(3));
  CHECK_FALSE(ngn::svgLength(folly::dynamic(nullptr)).set);
  CHECK_FALSE(ngn::svgLength(folly::dynamic("auto")).set);
  CHECK(ngn::svgLengths(folly::dynamic::array("1", 2)) == std::vector<SvgLength>{len(1), len(2)});
}

TEST_CASE("a brush is a colour, none, currentColor or a reference, as react-native-svg sends it") {
  CHECK(ngn::svgBrush(folly::dynamic::object("type", 0)("payload", 0xff336699u)) == color(0xff336699));
  CHECK(ngn::svgBrush(folly::dynamic::object("type", 2)).type == SvgBrush::Type::CurrentColor);
  CHECK(ngn::svgBrush(folly::dynamic::object("type", 1)("brushRef", "g")) == SvgBrush{.type = SvgBrush::Type::Ref, .ref = "g"});
  // Null is both `fill="none"` and a fill never sent: propList tells them apart when drawing.
  CHECK(ngn::svgBrush(folly::dynamic(nullptr)).type == SvgBrush::Type::Unset);
  // A bare colour number, as older versions sent.
  CHECK(ngn::svgBrush(folly::dynamic(0xff00ff00u)) == color(0xff00ff00));
}

TEST_CASE("a viewBox fits its viewport: met, sliced, or stretched with align none") {
  auto met = ngn::svgViewBoxTransform({0, 0, 24, 12}, "xMidYMid", 0, 48, 48);
  CHECK(met == ngn::SvgMatrix{2, 0, 0, 2, 0, 12});
  auto sliced = ngn::svgViewBoxTransform({0, 0, 24, 12}, "xMidYMid", 1, 48, 48);
  CHECK(sliced == ngn::SvgMatrix{4, 0, 0, 4, -24, 0});
  auto start = ngn::svgViewBoxTransform({10, 10, 24, 12}, "xMinYMin", 0, 48, 48);
  CHECK(start == ngn::SvgMatrix{2, 0, 0, 2, -20, -20});
  auto stretched = ngn::svgViewBoxTransform({0, 0, 24, 12}, "none", 0, 48, 48);
  CHECK(stretched == ngn::SvgMatrix{2, 0, 0, 4, 0, 0});
}

TEST_CASE("an icon: a stroke set on the root group with currentColor reaches its paths") {
  auto root = svg(24, 24);
  root.color = 0xffff9f0a;
  SvgElement group{.kind = SvgKind::Group};
  group.fill = none();
  group.stroke = {.type = SvgBrush::Type::CurrentColor};
  group.strokeWidth = len(1.5);
  group.strokeLinecap = 1;
  group.strokeLinejoin = 1;
  group.propList = {"fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin"};
  auto calls = draw(node(root, {node(group, {node(path("M4 4h16"))})}), 48, 48);
  CHECK(calls.front() == "save");
  CHECK(calls[1] == "concat 2 0 0 2 0 0");
  CHECK(std::vector<std::string>{calls.begin() + 2, calls.end() - 1} ==
        std::vector<std::string>{"stroke M4,4L20,4 w1.5 cap1 join1 #ffff9f0a"});
  CHECK(calls.back() == "restore");
}

TEST_CASE("a shape fills black by default and strokes nothing, and its own fill beats its group's") {
  SvgElement group{.kind = SvgKind::Group};
  group.fill = color(0xff0000ff);
  group.propList = {"fill"};
  auto own = path("M0 0H1V1Z");
  own.fill = color(0xffff0000);
  own.propList = {"fill"};
  auto inherits = path("M0 0H2V2Z");
  // react-native-svg sends its default fill on every shape; outside propList it is not the shape's own.
  inherits.fill = color(0xff000000);
  CHECK(drawn(node(svg(), {node(path("M0 0H3V3Z")), node(group, {node(own), node(inherits)})})) ==
        std::vector<std::string>{
            "fill M0,0L3,0L3,3Z #ff000000",
            "fill M0,0L1,0L1,1Z #ffff0000",
            "fill M0,0L2,0L2,2Z #ff0000ff",
        });
}

TEST_CASE("fill none, fill and stroke opacity, an evenodd rule and a dashed stroke") {
  auto p = path("M0 0H10V10Z");
  p.fill = color(0x80ff0000);
  p.fillOpacity = 0.5;
  p.fillRule = 0;
  p.stroke = color(0xff00ff00);
  p.strokeOpacity = 0.25;
  p.strokeWidth = len(2);
  p.strokeDasharray = {len(1), len(2)};
  p.propList = {"fill", "fillOpacity", "fillRule", "stroke", "strokeOpacity", "strokeWidth", "strokeDasharray"};
  // `fill="none"` arrives as null, with fill in propList.
  auto empty = path("M0 0H5");
  empty.propList = {"fill"};
  CHECK(drawn(node(svg(), {node(p), node(empty)})) ==
        std::vector<std::string>{
            "fill M0,0L10,0L10,10Z evenodd #80ff0000 @0.5",
            "stroke M0,0L10,0L10,10Z w2 cap0 join0 dash 1 2 #ff00ff00 @0.25",
        });
}

TEST_CASE("rect, rounded rect, circle, ellipse and line, with percentages of the viewBox") {
  auto r = rect(1, 2, 3, 4);
  auto rounded = rect(0, 0, 10, 10);
  rounded.lengths["rx"] = len(2);
  SvgElement circle{.kind = SvgKind::Circle};
  circle.lengths = {{"cx", pct(50)}, {"cy", pct(50)}, {"r", len(5)}};
  SvgElement ellipse{.kind = SvgKind::Ellipse};
  ellipse.lengths = {{"cx", len(10)}, {"cy", len(10)}, {"rx", len(4)}, {"ry", len(2)}};
  SvgElement line{.kind = SvgKind::Line};
  line.lengths = {{"x1", len(0)}, {"y1", len(0)}, {"x2", pct(100)}, {"y2", len(5)}};
  line.stroke = color(0xff000000);
  line.propList = {"stroke"};
  auto calls = drawn(node(svg(20, 10), {node(r), node(rounded), node(circle), node(ellipse), node(line)}), 20, 10);
  REQUIRE(calls.size() == 5);
  CHECK(calls[0] == "fill M1,2L4,2L4,6L1,6Z #ff000000");
  // A rounded corner is a curve from its start to its end, rx along each side.
  CHECK(calls[1].rfind("fill M2,0L8,0C10,2L10,8C8,10L2,10C0,8L0,2C2,0Z", 0) == 0);
  // A circle is four quarter arcs from its right-hand point, centred on (10, 5).
  CHECK(calls[2] == "fill M15,5C10,10C5,5C10,0C15,5Z #ff000000");
  CHECK(calls[3] == "fill M14,10C10,12C6,10C10,8C14,10Z #ff000000");
  // A line has no inside, so it is never filled, whatever its fill.
  CHECK(calls[4] == "stroke M0,0L20,5 w1 cap0 join0 #ff000000");
}

TEST_CASE("an element's transform and opacity wrap what it draws, and a hidden one draws nothing") {
  auto r = rect(0, 0, 1, 1);
  r.matrix = ngn::SvgMatrix::translate(5, 6);
  r.opacity = 0.5;
  auto hidden = rect(0, 0, 2, 2);
  hidden.hidden = true;
  auto calls = draw(node(svg(), {node(r), node(hidden)}));
  CHECK(calls == std::vector<std::string>{
                     "save",
                     "save",
                     "concat 1 0 0 1 5 6",
                     "layer 0.5",
                     "fill M0,0L1,0L1,1L0,1Z #ff000000",
                     "end layer",
                     "restore",
                     "restore",
                 });
}

TEST_CASE("a gradient fill in objectBoundingBox units spans the shape's bounds") {
  SvgElement gradient{.kind = SvgKind::LinearGradient, .name = "g"};
  gradient.lengths = {{"x1", pct(0)}, {"y1", pct(0)}, {"x2", pct(100)}, {"y2", pct(0)}};
  gradient.stops = {{0, 0xffff0000}, {1, 0xff0000ff}};
  auto r = rect(10, 20, 30, 40);
  r.fill = {.type = SvgBrush::Type::Ref, .ref = "g"};
  r.propList = {"fill"};
  SvgElement defs{.kind = SvgKind::Defs};
  CHECK(drawn(node(svg(), {node(defs, {node(gradient)}), node(r)})) ==
        std::vector<std::string>{"fill M10,20L40,20L40,60L10,60Z linear(0,0 1,0 stops2 t30,40,10,20)"});
}

TEST_CASE("a radial gradient in user space, and a reference to nothing paints nothing") {
  SvgElement gradient{.kind = SvgKind::RadialGradient, .name = "r"};
  gradient.units = 1;
  gradient.lengths = {{"cx", len(12)}, {"cy", len(12)}, {"rx", len(6)}, {"ry", len(6)}, {"fx", len(10)}, {"fy", len(10)}};
  gradient.stops = {{0, 0xffffffff}, {1, 0xff000000}};
  auto r = rect(0, 0, 24, 24);
  r.fill = {.type = SvgBrush::Type::Ref, .ref = "r"};
  r.propList = {"fill"};
  auto missing = rect(0, 0, 1, 1);
  missing.fill = {.type = SvgBrush::Type::Ref, .ref = "nowhere"};
  missing.propList = {"fill"};
  CHECK(drawn(node(svg(24, 24), {node(gradient), node(r), node(missing)})) ==
        std::vector<std::string>{"fill M0,0L24,0L24,24L0,24Z radial(12,12 10,10 r6 stops2 t1,1,0,0)"});
}

TEST_CASE("a clip path clips to its children's shapes, in their transforms") {
  SvgElement clip{.kind = SvgKind::ClipPath, .name = "c"};
  auto inner = rect(0, 0, 4, 4);
  inner.matrix = ngn::SvgMatrix::translate(1, 1);
  auto r = rect(0, 0, 10, 10);
  r.clipPath = "c";
  r.clipRule = 0;
  CHECK(drawn(node(svg(), {node(clip, {node(inner)}), node(r)})) ==
        std::vector<std::string>{"clip M1,1L5,1L5,5L1,5Z evenodd", "fill M0,0L10,0L10,10L0,10Z #ff000000"});
}

TEST_CASE("a mask draws its content as the mask, then the element through it") {
  SvgElement mask{.kind = SvgKind::Mask, .name = "m"};
  mask.units = 1;
  mask.lengths = {{"x", len(0)}, {"y", len(0)}, {"width", len(24)}, {"height", len(24)}};
  auto white = rect(0, 0, 12, 24);
  white.fill = color(0xffffffff);
  white.propList = {"fill"};
  auto r = rect(0, 0, 24, 24);
  r.mask = "m";
  auto calls = draw(node(svg(), {node(mask, {node(white)}), node(r)}));
  std::vector<std::string> between;
  bool in = false;
  for (const auto &c : calls) {
    if (c == "mask") {
      in = true;
    }
    if (in) {
      between.push_back(c);
    }
    if (c == "end masked") {
      break;
    }
  }
  CHECK(between == std::vector<std::string>{
                       "mask",
                       "clip M0,0L24,0L24,24L0,24Z",
                       "fill M0,0L12,0L12,24L0,24Z #ffffffff",
                       "end mask",
                       "fill M0,0L24,0L24,24L0,24Z #ff000000",
                       "end masked",
                   });
}

TEST_CASE("use draws what it refers to at its x and y, and a symbol through its viewBox") {
  auto shape = rect(0, 0, 2, 2);
  shape.name = "s";
  SvgElement use{.kind = SvgKind::Use};
  use.href = "s";
  use.lengths = {{"x", len(10)}, {"y", len(0)}};
  SvgElement symbol{.kind = SvgKind::Symbol, .name = "sym"};
  symbol.vbWidth = 10;
  symbol.vbHeight = 10;
  symbol.align = "xMidYMid";
  SvgElement useSymbol{.kind = SvgKind::Use};
  useSymbol.href = "sym";
  useSymbol.lengths = {{"width", len(20)}, {"height", len(20)}};
  SvgElement defs{.kind = SvgKind::Defs};
  auto calls = draw(node(svg(), {node(defs, {node(shape)}), node(use), node(symbol, {node(rect(0, 0, 10, 10))}), node(useSymbol)}));
  // Only the uses draw: neither defs nor a symbol draws where it is.
  Recorder recorded;
  recorded.calls = calls;
  CHECK(recorded.drawn() ==
        std::vector<std::string>{"fill M0,0L2,0L2,2L0,2Z #ff000000", "fill M0,0L10,0L10,10L0,10Z #ff000000"});
  CHECK(std::find(calls.begin(), calls.end(), "concat 1 0 0 1 10 0") != calls.end());
  CHECK(std::find(calls.begin(), calls.end(), "concat 2 0 0 2 0 0") != calls.end());
}

TEST_CASE("a use that refers to itself or its ancestor draws nothing rather than recursing") {
  SvgElement group{.kind = SvgKind::Group, .name = "loop"};
  SvgElement use{.kind = SvgKind::Use};
  use.href = "loop";
  CHECK(drawn(node(svg(), {node(group, {node(use), node(rect(0, 0, 1, 1))})})) ==
        std::vector<std::string>{"fill M0,0L1,0L1,1L0,1Z #ff000000"});
}

TEST_CASE("clip and mask references that lead back to themselves draw nothing rather than recursing") {
  // Two uses in a clip path that refer to each other.
  SvgElement clip{.kind = SvgKind::ClipPath, .name = "c"};
  SvgElement a{.kind = SvgKind::Use, .name = "a"};
  a.href = "b";
  SvgElement b{.kind = SvgKind::Use, .name = "b"};
  b.href = "a";
  auto clipped = rect(0, 0, 10, 10);
  clipped.clipPath = "c";
  CHECK(drawn(node(svg(), {node(clip, {node(a), node(b)}), node(clipped)})).size() == 2);

  // A mask holding a shape masked by that mask again.
  SvgElement mask{.kind = SvgKind::Mask, .name = "m"};
  auto inner = rect(0, 0, 4, 4);
  inner.mask = "m";
  auto masked = rect(0, 0, 10, 10);
  masked.mask = "m";
  auto calls = draw(node(svg(), {node(mask, {node(inner)}), node(masked)}));
  CHECK(std::count(calls.begin(), calls.end(), "mask") == 2);
}

TEST_CASE("a blur far wider than its image takes no longer than a narrow one") {
  ngn::SvgFilter filter{.region = {0, 0, 1, 1}};
  ngn::SvgFilterStep blur{.type = ngn::SvgFilterStep::Type::GaussianBlur, .in1 = "SourceGraphic", .result = "#0"};
  blur.subregion = {0, 0, 1, 1};
  blur.stdDeviationX = blur.stdDeviationY = 1e8;
  filter.steps.push_back(blur);
  ngn::SvgPixels source{.width = 1, .height = 1, .rgba = {255, 255, 255, 255}};
  auto started = std::chrono::steady_clock::now();
  auto out = ngn::runSvgFilter(filter, source, {});
  CHECK(std::chrono::steady_clock::now() - started < std::chrono::milliseconds(200));
  REQUIRE(out.rgba.size() == 4);
  CHECK(out.rgba[3] == 0);
  // Past an int's reach, it is capped, not undefined.
  filter.steps[0].stdDeviationX = filter.steps[0].stdDeviationY = 1e12;
  CHECK(ngn::runSvgFilter(filter, source, {}).rgba.size() == 4);
}

TEST_CASE("text draws each span after the last, at the text's position, in its font size and fill") {
  SvgElement text{.kind = SvgKind::Text};
  text.xs = {len(2)};
  text.ys = {len(20)};
  text.fontSize = len(12);
  text.fill = color(0xff112233);
  text.propList = {"fill"};
  SvgElement a{.kind = SvgKind::TSpan, .content = "ab"};
  SvgElement b{.kind = SvgKind::TSpan, .content = "c"};
  b.dxs = {len(1)};
  CHECK(drawn(node(svg(), {node(text, {node(a), node(b)})})) ==
        std::vector<std::string>{"text 'ab' 2,20 12 #ff112233", "text 'c' 23,20 12 #ff112233"});
}

TEST_CASE("an image draws its source in its box") {
  SvgElement image{.kind = SvgKind::Image, .uri = "file:///a.png"};
  image.lengths = {{"x", len(1)}, {"y", len(2)}, {"width", pct(50)}, {"height", len(4)}};
  CHECK(drawn(node(svg(), {node(image)}), 24, 24) == std::vector<std::string>{"image file:///a.png 1,2 12x4"});
}

TEST_CASE("without a viewBox, bbWidth and bbHeight size the svg's own units within its view") {
  auto root = svg();
  root.bbWidth = len(12);
  root.bbHeight = pct(50);
  root.vbWidth = 6;
  root.vbHeight = 6;
  auto calls = draw(node(root, {node(rect(0, 0, 6, 6))}), 24, 24);
  CHECK(calls[1] == "concat 2 0 0 2 0 0");
}

namespace {

// A view's svg element, as react-native-svg's glue reads it from the library's props.
struct ElementProps : Props {
  SvgElement element;
};

std::shared_ptr<const Props> props(SvgElement element) {
  auto p = std::make_shared<ElementProps>();
  p->element = std::move(element);
  return p;
}

std::optional<SvgElement> readElement(const Props &p) {
  const auto *e = dynamic_cast<const ElementProps *>(&p);
  return e ? std::optional<SvgElement>(e->element) : std::nullopt;
}

struct Svgs {
  ngn::ViewTree tree;
  ngn::SvgDrawings drawings{readElement};

  void add(Tag tag, Tag parent, std::shared_ptr<const Props> p) {
    tree.create(ngn::testing::shadowView(tag, "RNSVG", {{0, 0}, {24, 24}}, std::move(p)));
    drawings.changed(tree, tag);
    if (parent != -1) {
      tree.insert(parent, tag, static_cast<int>(tree.find(parent)->children.size()));
      drawings.changed(tree, parent);
    }
  }
  void setProps(Tag tag, std::shared_ptr<const Props> p) {
    auto view = tree.find(tag)->view;
    view.props = std::move(p);
    tree.update(view);
    drawings.changed(tree, tag);
  }
};

} // namespace

TEST_CASE("the svgs mounted: each svg's document, again when an element in it changes, and not when nothing did") {
  Svgs s;
  s.add(1, -1, std::make_shared<ViewProps>());
  s.add(2, 1, props(svg(24, 24)));
  s.add(3, 2, props(SvgElement{.kind = SvgKind::Group}));
  s.add(4, 3, props(path("M0 0H1")));
  auto first = s.drawings.settle(s.tree);
  REQUIRE(first.size() == 1);
  CHECK(first[0].svg == 2);
  REQUIRE(first[0].document->root.children.size() == 1);
  CHECK(first[0].document->root.children[0].children[0].element.d == "M0 0H1");
  CHECK(s.drawings.settle(s.tree).empty());

  // A path's props change: its svg is drawn again.
  s.setProps(4, props(path("M0 0H2")));
  auto second = s.drawings.settle(s.tree);
  REQUIRE(second.size() == 1);
  CHECK(second[0].document->root.children[0].children[0].element.d == "M0 0H2");

  // The same props again, as a new object: nothing to draw.
  s.setProps(4, props(path("M0 0H2")));
  CHECK(s.drawings.settle(s.tree).empty());

  // A child removed from its group.
  s.tree.remove(3, 4);
  s.drawings.changed(s.tree, 3);
  s.drawings.deleted(4);
  s.tree.destroy(4);
  auto third = s.drawings.settle(s.tree);
  REQUIRE(third.size() == 1);
  CHECK(third[0].document->root.children[0].children.empty());

  // The svg itself goes: nothing is left to draw, and nothing is sent for it.
  s.tree.remove(1, 2);
  s.drawings.deleted(2);
  CHECK(s.drawings.settle(s.tree).empty());
}

TEST_CASE("the svgs mounted: a view that is no svg element is skipped, and so is what it holds") {
  Svgs s;
  s.add(2, -1, props(svg()));
  s.add(3, 2, std::make_shared<ViewProps>());
  s.add(4, 3, props(path("M0 0H1")));
  s.add(5, 2, props(path("M0 0H3")));
  auto drawn = s.drawings.settle(s.tree);
  REQUIRE(drawn.size() == 1);
  REQUIRE(drawn[0].document->root.children.size() == 1);
  CHECK(drawn[0].document->root.children[0].element.d == "M0 0H3");
}

namespace {

SvgElement foreignObject(Tag view, std::map<std::string, SvgLength> lengths = {}) {
  SvgElement e{.kind = SvgKind::ForeignObject};
  e.lengths = std::move(lengths);
  e.view = view;
  return e;
}

} // namespace

TEST_CASE("a foreignObject draws its views at its x and y, cut to its box, in its place among the shapes") {
  auto object = foreignObject(7, {{"x", len(10)}, {"y", len(20)}, {"width", len(120)}, {"height", len(40)}});
  auto calls = draw(node(svg(), {node(rect(0, 0, 1, 1)), node(object), node(rect(2, 2, 1, 1))}), 200, 100);
  auto at = std::find(calls.begin(), calls.end(), "views 7");
  REQUIRE(at != calls.end());
  CHECK(std::vector<std::string>(at - 3, at + 2) ==
        std::vector<std::string>{"save", "concat 1 0 0 1 10 20", "clip M0,0L120,0L120,40L0,40Z", "views 7", "restore"});
  CHECK(drawn(node(svg(), {node(rect(0, 0, 1, 1)), node(object), node(rect(2, 2, 1, 1))}), 200, 100) ==
        std::vector<std::string>{
            "fill M0,0L1,0L1,1L0,1Z #ff000000", "clip M0,0L120,0L120,40L0,40Z", "views 7", "fill M2,2L3,2L3,3L2,3Z #ff000000"});
}

TEST_CASE("a foreignObject's box: the whole viewport where it says nothing, and percentages of it") {
  CHECK(drawn(node(svg(), {node(foreignObject(7))}), 200, 100) == std::vector<std::string>{"clip M0,0L200,0L200,100L0,100Z", "views 7"});
  auto half = foreignObject(7, {{"x", pct(10)}, {"width", pct(50)}, {"height", pct(50)}});
  auto calls = draw(node(svg(), {node(half)}), 200, 100);
  CHECK(std::find(calls.begin(), calls.end(), "concat 1 0 0 1 20 0") != calls.end());
  CHECK(std::find(calls.begin(), calls.end(), "clip M0,0L100,0L100,50L0,50Z") != calls.end());
}

TEST_CASE("a foreignObject with an empty box, or no view, draws nothing; a transform, an opacity or hidden wraps it as a group") {
  CHECK(drawn(node(svg(), {node(foreignObject(7, {{"width", len(0)}}))})).empty());
  CHECK(drawn(node(svg(), {node(foreignObject(7, {{"height", len(-1)}}))})).empty());
  CHECK(drawn(node(svg(), {node(foreignObject(-1))})).empty());
  auto hidden = foreignObject(7);
  hidden.hidden = true;
  CHECK(drawn(node(svg(), {node(hidden)})).empty());

  auto moved = foreignObject(7, {{"width", len(4)}, {"height", len(4)}});
  moved.matrix = ngn::SvgMatrix{0, 1, -1, 0, 5, 6};
  moved.opacity = 0.5;
  CHECK(draw(node(svg(), {node(moved)})) ==
        std::vector<std::string>{
            "save", "save", "concat 0 1 -1 0 5 6", "layer 0.5", "save", "concat 1 0 0 1 0 0", "clip M0,0L4,0L4,4L0,4Z",
            "views 7", "restore", "end layer", "restore", "restore"});
}

TEST_CASE("a mask in objectBoundingBox units spans a foreignObject's box") {
  SvgElement mask{.kind = SvgKind::Mask, .name = "m"};
  mask.units = 0;
  auto object = foreignObject(7, {{"x", len(10)}, {"y", len(20)}, {"width", len(100)}, {"height", len(50)}});
  object.mask = "m";
  auto calls = draw(node(svg(), {node(mask, {node(rect(0, 0, 1, 1))}), node(object)}), 200, 100);
  CHECK(std::find(calls.begin(), calls.end(), "clip M0,15L120,15L120,75L0,75Z") != calls.end());
}

TEST_CASE("the svgs mounted: a foreignObject's document names its view") {
  Svgs s;
  s.add(2, -1, props(svg()));
  s.add(3, 2, props(SvgElement{.kind = SvgKind::ForeignObject}));
  auto drawn = s.drawings.settle(s.tree);
  REQUIRE(drawn.size() == 1);
  CHECK(drawn[0].document->root.children[0].element.view == 3);
}

TEST_CASE("the svgs mounted: a view in a foreignObject draws its svg again when it is made, changed, relaid out or removed") {
  Svgs s;
  s.add(2, -1, props(svg()));
  s.add(3, 2, props(SvgElement{.kind = SvgKind::Group}));
  s.add(4, 3, props(SvgElement{.kind = SvgKind::ForeignObject}));
  s.add(5, 4, std::make_shared<ViewProps>());
  s.add(6, 5, std::make_shared<ViewProps>());
  auto first = s.drawings.settle(s.tree);
  REQUIRE(first.size() == 1);
  CHECK(s.drawings.settle(s.tree).empty());
  auto again = [&] {
    auto drawn = s.drawings.settle(s.tree);
    // The same document, drawn again for the views in it.
    return drawn.size() == 1 && drawn[0].svg == 2 && drawn[0].document == first[0].document;
  };

  // A view deep in it changes its props, its layout, or its state.
  s.setProps(6, std::make_shared<ViewProps>());
  CHECK(again());
  s.drawings.relaidOut(s.tree, 6);
  CHECK(again());
  s.drawings.relaidOut(s.tree, 5);
  CHECK(again());

  // A view is made in it.
  s.add(7, 4, std::make_shared<ViewProps>());
  CHECK(again());

  // A view is removed from it, deep and at the top.
  s.tree.remove(5, 6);
  s.drawings.changed(s.tree, 5);
  s.drawings.deleted(6);
  s.tree.destroy(6);
  CHECK(again());
  s.tree.remove(4, 7);
  s.drawings.changed(s.tree, 4);
  s.drawings.deleted(7);
  s.tree.destroy(7);
  CHECK(again());
  CHECK(s.drawings.settle(s.tree).empty());
}

TEST_CASE("the svgs mounted: a view outside any foreignObject, or in one that has gone, draws nothing again") {
  Svgs s;
  s.add(1, -1, std::make_shared<ViewProps>());
  s.add(2, 1, props(svg()));
  s.add(3, 2, props(SvgElement{.kind = SvgKind::ForeignObject}));
  s.add(4, 3, std::make_shared<ViewProps>());
  s.add(8, 1, std::make_shared<ViewProps>());
  REQUIRE(s.drawings.settle(s.tree).size() == 1);

  // A view beside the svg, and an element of it, relaid out: nothing is drawn again.
  s.drawings.relaidOut(s.tree, 8);
  s.drawings.relaidOut(s.tree, 2);
  CHECK(s.drawings.settle(s.tree).empty());

  // The foreignObject goes, and its view moves beside the svg: a change to it draws nothing.
  s.tree.remove(3, 4);
  s.tree.remove(2, 3);
  s.drawings.changed(s.tree, 2);
  s.drawings.deleted(3);
  s.tree.destroy(3);
  REQUIRE(s.drawings.settle(s.tree).size() == 1);
  s.tree.insert(1, 4, 2);
  s.drawings.changed(s.tree, 1);
  s.drawings.relaidOut(s.tree, 4);
  s.setProps(4, std::make_shared<ViewProps>());
  CHECK(s.drawings.settle(s.tree).empty());
}

TEST_CASE("the svgs mounted: an svg that goes is not drawn again for the views in its foreignObject") {
  Svgs s;
  s.add(2, -1, props(svg()));
  s.add(3, 2, props(SvgElement{.kind = SvgKind::ForeignObject}));
  s.add(4, 3, std::make_shared<ViewProps>());
  REQUIRE(s.drawings.settle(s.tree).size() == 1);
  s.drawings.relaidOut(s.tree, 4);
  s.drawings.deleted(2);
  s.tree.destroy(2);
  CHECK(s.drawings.settle(s.tree).empty());
}
