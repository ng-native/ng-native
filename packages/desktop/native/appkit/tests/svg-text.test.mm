// Anchored text and text along a path drawn by the Core Graphics canvas (cg-canvas.mm) into bitmaps.
#include "../cg-canvas.h"

#include <doctest/doctest.h>

#include <algorithm>
#include <vector>

using ngn::SvgElement;
using ngn::SvgKind;
using ngn::SvgLength;
using ngn::SvgNode;

namespace {

SvgLength len(double v) {
  return {.value = v, .set = true};
}
SvgNode node(SvgElement element, std::vector<SvgNode> children = {}) {
  return {.element = std::move(element), .children = std::move(children)};
}

// Where a drawing put ink, in points: the box around every pixel with any alpha.
struct Ink {
  int left{1 << 30}, top{1 << 30}, right{-1}, bottom{-1};
  bool any() const { return right >= 0; }
};

Ink inkOf(SvgNode root, int w, int h) {
  std::vector<uint8_t> data(static_cast<size_t>(w * h * 4), 0);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(data.data(), w, h, 8, w * 4, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  CGContextTranslateCTM(context, 0, h);
  CGContextScaleCTM(context, 1, -1);
  auto canvas = NGNMakeCGCanvas(context, CGSizeMake(w, h), 1, nil);
  ngn::drawSvg({.root = std::move(root)}, w, h, *canvas);
  canvas.reset();
  CGContextRelease(context);
  Ink ink;
  for (int y = 0; y < h; ++y) {
    for (int x = 0; x < w; ++x) {
      if (data[static_cast<size_t>((y * w + x) * 4 + 3)] > 0) {
        ink.left = std::min(ink.left, x);
        ink.right = std::max(ink.right, x);
        ink.top = std::min(ink.top, y);
        ink.bottom = std::max(ink.bottom, y);
      }
    }
  }
  return ink;
}

SvgNode anchored(std::string anchor) {
  SvgElement text{.kind = SvgKind::Text};
  text.xs = {len(100)};
  text.ys = {len(30)};
  text.fontSize = len(20);
  text.textAnchor = std::move(anchor);
  return node({.kind = SvgKind::Svg}, {node(text, {node({.kind = SvgKind::TSpan, .content = "HHHH"})})});
}

} // namespace

TEST_CASE("middle-anchored text is drawn centred on its x, end-anchored text ends at it") {
  auto start = inkOf(anchored("start"), 200, 40);
  REQUIRE(start.any());
  CHECK(start.left >= 99);
  auto middle = inkOf(anchored("middle"), 200, 40);
  REQUIRE(middle.any());
  CHECK((middle.left + middle.right) / 2.0 == doctest::Approx(100).epsilon(0.02));
  auto end = inkOf(anchored("end"), 200, 40);
  REQUIRE(end.any());
  CHECK(end.right <= 101);
  CHECK(end.right >= 95);
}

TEST_CASE("text on a vertical path is drawn down it, turned on its side") {
  SvgElement path{.kind = SvgKind::Path, .name = "down", .d = "M100 10 V190"};
  SvgElement text{.kind = SvgKind::Text};
  text.fontSize = len(20);
  SvgElement along{.kind = SvgKind::TextPath, .href = "down"};
  auto ink = inkOf(
      node({.kind = SvgKind::Svg},
           {node({.kind = SvgKind::Defs}, {node(path)}),
            node(text, {node(along, {node({.kind = SvgKind::TSpan, .content = "HHHH"})})})}),
      200,
      200);
  REQUIRE(ink.any());
  // Taller than wide, its baseline on the path with the glyphs to its right.
  CHECK(ink.bottom - ink.top > 2 * (ink.right - ink.left));
  CHECK(ink.left >= 99);
  CHECK(ink.top >= 9);
  CHECK(ink.right <= 125);
}
