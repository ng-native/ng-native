// Markers, patterns and filters drawn by the Core Graphics canvas (cg-canvas.mm) into bitmaps.
#include "../cg-canvas.h"

#include <doctest/doctest.h>

#include <array>
#include <cmath>

using ngn::SvgBrush;
using ngn::SvgElement;
using ngn::SvgKind;
using ngn::SvgLength;
using ngn::SvgNode;

namespace {

SvgLength len(double v) {
  return {.value = v, .set = true};
}
SvgBrush color(uint32_t argb) {
  return {.type = SvgBrush::Type::Color, .argb = argb};
}
SvgNode node(SvgElement element, std::vector<SvgNode> children = {}) {
  return {.element = std::move(element), .children = std::move(children)};
}
SvgElement rect(double x, double y, double w, double h, uint32_t argb) {
  SvgElement e{.kind = SvgKind::Rect};
  e.lengths = {{"x", len(x)}, {"y", len(y)}, {"width", len(w)}, {"height", len(h)}};
  e.fill = color(argb);
  return e;
}
SvgElement named(SvgKind kind, std::string name) {
  SvgElement e{.kind = kind};
  e.name = std::move(name);
  return e;
}

// A view's worth of pixels, drawn as the svg view draws: top left, y down, `scale` pixels a point.
struct Bitmap {
  int width, height;
  double scale;
  std::vector<uint8_t> data;

  Bitmap(SvgNode root, int w, int h, double s = 1) : width(w), height(h), scale(s) {
    size_t pw = static_cast<size_t>(w * s), ph = static_cast<size_t>(h * s);
    data.assign(pw * ph * 4, 0);
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef context = CGBitmapContextCreate(data.data(), pw, ph, 8, pw * 4, space, kCGImageAlphaPremultipliedLast);
    CGColorSpaceRelease(space);
    CGContextTranslateCTM(context, 0, ph);
    CGContextScaleCTM(context, s, -s);
    auto canvas = NGNMakeCGCanvas(context, CGSizeMake(w, h), s, nil);
    ngn::drawSvg({.root = std::move(root)}, w, h, *canvas);
    canvas.reset();
    CGContextRelease(context);
  }

  // The pixel under a point, as RGBA.
  std::array<int, 4> at(double x, double y) const {
    size_t px = static_cast<size_t>(x * scale), py = static_cast<size_t>(y * scale);
    const uint8_t *p = &data[(py * static_cast<size_t>(width * scale) + px) * 4];
    return {p[0], p[1], p[2], p[3]};
  }
};

std::string show(const std::array<int, 4> &p) {
  return std::to_string(p[0]) + "," + std::to_string(p[1]) + "," + std::to_string(p[2]) + "," + std::to_string(p[3]);
}

SvgNode shadowFilter() {
  SvgElement f = named(SvgKind::Filter, "shadow");
  f.units = 1;
  f.lengths = {{"x", len(0)}, {"y", len(0)}, {"width", len(60)}, {"height", len(60)}};
  SvgElement blur{.kind = SvgKind::FeGaussianBlur};
  blur.in1 = "SourceAlpha";
  blur.stdDeviationX = 1;
  blur.stdDeviationY = 1;
  SvgElement offset{.kind = SvgKind::FeOffset};
  offset.lengths = {{"dx", len(6)}, {"dy", len(6)}};
  offset.result = "moved";
  SvgElement flood{.kind = SvgKind::FeFlood};
  flood.flood = color(0xff000000);
  flood.floodOpacity = 0.5;
  SvgElement composite{.kind = SvgKind::FeComposite};
  composite.in2 = "moved";
  composite.op = 1;
  SvgElement merge{.kind = SvgKind::FeMerge};
  merge.nodes = {"", "SourceGraphic"};
  return node(f, {node(blur), node(offset), node(flood), node(composite), node(merge)});
}

} // namespace

TEST_CASE("a drop shadow: the shape in place, a soft half-black copy below and right of it, nothing elsewhere") {
  for (double scale : {1.0, 2.0}) {
    SvgElement shape = rect(10, 10, 20, 20, 0xffff0000);
    shape.filter = "shadow";
    Bitmap bitmap(node({.kind = SvgKind::Svg}, {shadowFilter(), node(shape)}), 50, 50, scale);
    INFO("scale " << scale);
    CHECK(show(bitmap.at(20, 20)) == "255,0,0,255");
    // The shadow alone, past the shape's corner.
    auto shadow = bitmap.at(33, 33);
    INFO(show(shadow));
    CHECK(shadow[0] == 0);
    CHECK(shadow[3] == doctest::Approx(128).epsilon(0.1));
    // Its edge is blurred: part way in, part way out.
    auto edge = bitmap.at(36, 33);
    CHECK(edge[3] > 0);
    CHECK(edge[3] < shadow[3]);
    CHECK(bitmap.at(5, 45)[3] == 0);
    CHECK(bitmap.at(12, 33)[3] == 0);
  }
}

TEST_CASE("a colour matrix draws its element grey") {
  SvgElement f = named(SvgKind::Filter, "grey");
  SvgElement matrix{.kind = SvgKind::FeColorMatrix};
  matrix.op = 1;
  matrix.values = {0};
  SvgElement shape = rect(0, 0, 10, 10, 0xffff0000);
  shape.filter = "grey";
  Bitmap bitmap(node({.kind = SvgKind::Svg}, {node(f, {node(matrix)}), node(shape)}), 20, 20);
  auto p = bitmap.at(5, 5);
  INFO(show(p));
  CHECK(p[0] == p[1]);
  CHECK(p[1] == p[2]);
  CHECK(p[0] == doctest::Approx(54).epsilon(0.15));
  CHECK(p[3] == 255);
}

TEST_CASE("a pattern tiles its content upright across the shape, from the tile's origin") {
  for (double scale : {1.0, 2.0}) {
    SvgElement p = named(SvgKind::Pattern, "quarters");
    p.units = 1;
    p.lengths = {{"x", len(0)}, {"y", len(0)}, {"width", len(10)}, {"height", len(10)}};
    SvgElement shape = rect(0, 0, 40, 30, 0);
    shape.fill = {.type = SvgBrush::Type::Ref, .ref = "quarters"};
    // Blue in each tile's top left quarter.
    Bitmap bitmap(
        node({.kind = SvgKind::Svg}, {node(p, {node(rect(0, 0, 5, 5, 0xff0000ff))}), node(shape)}), 50, 50, scale);
    INFO("scale " << scale);
    CHECK(show(bitmap.at(2, 2)) == "0,0,255,255");
    CHECK(show(bitmap.at(12, 22)) == "0,0,255,255");
    CHECK(show(bitmap.at(32, 12)) == "0,0,255,255");
    CHECK(bitmap.at(2, 7)[3] == 0);
    CHECK(bitmap.at(7, 2)[3] == 0);
    CHECK(bitmap.at(17, 17)[3] == 0);
    // Only inside the shape.
    CHECK(bitmap.at(42, 2)[3] == 0);
    CHECK(bitmap.at(2, 32)[3] == 0);
  }
}

TEST_CASE("a marker draws its content at the line's end, turned along it") {
  SvgElement m = named(SvgKind::Marker, "tip");
  m.markerUnits = "userSpaceOnUse";
  m.orient = "auto";
  m.lengths = {{"markerWidth", len(10)}, {"markerHeight", len(10)}, {"refX", len(0)}, {"refY", len(5)}};
  // A bar along the marker's x axis, above its ref line only.
  SvgElement bar = rect(0, 0, 8, 5, 0xff00ff00);
  SvgElement line{.kind = SvgKind::Path};
  line.d = "M20,5 L20,30";
  line.fill = {.type = SvgBrush::Type::None};
  line.markerEnd = "tip";
  Bitmap bitmap(node({.kind = SvgKind::Svg}, {node(m, {node(bar)}), node(line)}), 40, 50);
  // The line runs down, so the marker's x runs down from (20, 30) and its "above" is to the right.
  CHECK(show(bitmap.at(22, 34)) == "0,255,0,255");
  CHECK(bitmap.at(18, 34)[3] == 0);
  CHECK(bitmap.at(22, 26)[3] == 0);
  CHECK(bitmap.at(22, 39)[3] == 0);
}
