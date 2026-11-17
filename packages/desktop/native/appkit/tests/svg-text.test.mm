// Anchored text and text along a path drawn by the Core Graphics canvas (cg-canvas.mm) into bitmaps.
#include "../cg-canvas.h"

#include <doctest/doctest.h>

#include <algorithm>
#include <cstdlib>
#include <string>
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
  uint8_t alpha{0}; // the strongest pixel's
  bool any() const { return right >= 0; }
};

// The alpha of every pixel `root` draws in a `w` by `h` bitmap, row by row from the top.
std::vector<uint8_t> alphaOf(SvgNode root, int w, int h) {
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
  std::vector<uint8_t> alpha(static_cast<size_t>(w * h));
  for (size_t i = 0; i < alpha.size(); ++i) {
    alpha[i] = data[i * 4 + 3];
  }
  return alpha;
}

Ink inkOf(SvgNode root, int w, int h) {
  auto alpha = alphaOf(std::move(root), w, h);
  Ink ink;
  for (int y = 0; y < h; ++y) {
    for (int x = 0; x < w; ++x) {
      uint8_t a = alpha[static_cast<size_t>(y * w + x)];
      ink.alpha = std::max(ink.alpha, a);
      if (a > 0) {
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

// What the Core Graphics canvas splits `text` into for a path, in the system font at 20 points.
std::vector<ngn::SvgGlyphCluster> clustersOf(const std::string &text, const std::string &family = "") {
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(nullptr, 4, 4, 8, 16, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  auto canvas = NGNMakeCGCanvas(context, CGSizeMake(4, 4), 1, nil);
  auto clusters = canvas->glyphClusters(text, 20, family, "");
  canvas.reset();
  CGContextRelease(context);
  return clusters;
}

std::vector<std::string> textsOf(const std::vector<ngn::SvgGlyphCluster> &clusters) {
  std::vector<std::string> out;
  for (const auto &c : clusters) {
    out.push_back(c.text);
  }
  return out;
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

TEST_CASE("the canvas splits text for a path into grapheme clusters, as Foundation finds them") {
  // Devanagari ka and its dependent vowel sign i (U+0915 U+093F): one cluster, so one draw.
  CHECK(textsOf(clustersOf("\xe0\xa4\x95\xe0\xa4\xbf")) == std::vector<std::string>{"\xe0\xa4\x95\xe0\xa4\xbf"});
  // e with a combining acute, then x.
  CHECK(textsOf(clustersOf("e\xcc\x81x")) == std::vector<std::string>{"e\xcc\x81", "x"});
  // A woman and a laptop joined by a zero-width joiner.
  CHECK(clustersOf("\xf0\x9f\x91\xa9\xe2\x80\x8d\xf0\x9f\x92\xbb").size() == 1);
  // Two flags, each two regional letters.
  CHECK(textsOf(clustersOf("\xf0\x9f\x87\xab\xf0\x9f\x87\xb7\xf0\x9f\x87\xa9\xf0\x9f\x87\xaa")) ==
        std::vector<std::string>{"\xf0\x9f\x87\xab\xf0\x9f\x87\xb7", "\xf0\x9f\x87\xa9\xf0\x9f\x87\xaa"});
}

TEST_CASE("the canvas places each cluster where the shaped line has it, kerning included") {
  auto pair = clustersOf("AV");
  REQUIRE(pair.size() == 2);
  auto a = clustersOf("A");
  REQUIRE(a.size() == 1);
  CHECK(pair[0].x == doctest::Approx(0));
  // V starts where A, kerned, ends.
  CHECK(pair[1].x == doctest::Approx(pair[0].x + pair[0].advance));
  // The system font kerns A and V together: V starts before A's own advance ends.
  CHECK(pair[1].x < a[0].advance - 0.5);
}

TEST_CASE("the canvas keeps a ligature's characters together, as the one glyph that draws them") {
  // Hoefler Text joins f and i into one glyph.
  auto fi = clustersOf("fix", "Hoefler Text");
  CHECK(textsOf(fi) == std::vector<std::string>{"fi", "x"});
  REQUIRE(fi.size() == 2);
  CHECK(fi[1].x == doctest::Approx(fi[0].advance));
}

TEST_CASE("a textPath's opacity applies to the text on it: none at 0, half at 0.5") {
  auto drawn = [](double opacity) {
    SvgElement path{.kind = SvgKind::Path, .name = "line", .d = "M10 30 H190"};
    SvgElement text{.kind = SvgKind::Text};
    text.fontSize = len(20);
    SvgElement along{.kind = SvgKind::TextPath, .href = "line"};
    along.opacity = opacity;
    return inkOf(
        node({.kind = SvgKind::Svg},
             {node({.kind = SvgKind::Defs}, {node(path)}),
              node(text, {node(along, {node({.kind = SvgKind::TSpan, .content = "HHHH"})})})}),
        200,
        40);
  };
  CHECK(drawn(1).alpha == 255);
  CHECK_FALSE(drawn(0).any());
  auto half = drawn(0.5);
  REQUIRE(half.any());
  CHECK(half.alpha >= 120);
  CHECK(half.alpha <= 135);
}

TEST_CASE("text on a path is drawn in its fill") {
  SvgElement path{.kind = SvgKind::Path, .name = "line", .d = "M10 30 H190"};
  SvgElement text{.kind = SvgKind::Text};
  text.fontSize = len(20);
  text.fill = {.type = ngn::SvgBrush::Type::Color, .argb = 0xffff0000};
  text.propList = {"fill"};
  SvgElement along{.kind = SvgKind::TextPath, .href = "line"};
  int w = 200, h = 40;
  std::vector<uint8_t> data(static_cast<size_t>(w * h * 4), 0);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(data.data(), w, h, 8, w * 4, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  auto canvas = NGNMakeCGCanvas(context, CGSizeMake(w, h), 1, nil);
  ngn::drawSvg(
      {.root = node({.kind = SvgKind::Svg},
                    {node({.kind = SvgKind::Defs}, {node(path)}),
                     node(text, {node(along, {node({.kind = SvgKind::TSpan, .content = "HHHH"})})})})},
      w,
      h,
      *canvas);
  canvas.reset();
  CGContextRelease(context);
  int red = 0, other = 0;
  for (size_t i = 0; i < data.size(); i += 4) {
    if (data[i + 3] == 255) {
      (data[i] == 255 && data[i + 1] == 0 && data[i + 2] == 0 ? red : other) += 1;
    }
  }
  CHECK(red > 50);
  CHECK(other == 0);
}

TEST_CASE("spans that overlap under a textPath at opacity 0.5 stay at half where they overlap") {
  SvgElement path{.kind = SvgKind::Path, .name = "line", .d = "M10 30 H190"};
  SvgElement text{.kind = SvgKind::Text};
  text.fontSize = len(20);
  SvgElement along{.kind = SvgKind::TextPath, .href = "line"};
  along.opacity = 0.5;
  SvgElement first{.kind = SvgKind::TSpan, .content = "HHHH"}, second{.kind = SvgKind::TSpan, .content = "HHHH"};
  first.xs = {len(0)};
  second.xs = {len(0)};
  auto ink = inkOf(
      node({.kind = SvgKind::Svg},
           {node({.kind = SvgKind::Defs}, {node(path)}), node(text, {node(along, {node(first), node(second)})})}),
      200,
      40);
  REQUIRE(ink.any());
  CHECK(ink.alpha >= 120);
  CHECK(ink.alpha <= 135);
}

TEST_CASE("Arabic on a path keeps the joined forms its run shaped, drawn as the same text off a path") {
  // Beh twice: an initial form joined to a final one, not two isolated forms.
  const std::string text = "\xd8\xa8\xd8\xa8";
  auto drawn = [&](bool onPath) {
    SvgElement path{.kind = SvgKind::Path, .name = "line", .d = "M20 40 H180"};
    SvgElement t{.kind = SvgKind::Text};
    t.fontSize = len(30);
    if (onPath) {
      return alphaOf(
          node({.kind = SvgKind::Svg},
               {node({.kind = SvgKind::Defs}, {node(path)}),
                node(t, {node({.kind = SvgKind::TextPath, .href = "line"}, {node({.kind = SvgKind::TSpan, .content = text})})})}),
          200,
          60);
    }
    t.xs = {len(20)};
    t.ys = {len(40)};
    return alphaOf(node({.kind = SvgKind::Svg}, {node(t, {node({.kind = SvgKind::TSpan, .content = text})})}), 200, 60);
  };
  auto along = drawn(true), plain = drawn(false);
  int inked = 0, differ = 0;
  for (size_t i = 0; i < plain.size(); ++i) {
    inked += plain[i] > 64 ? 1 : 0;
    differ += std::abs(int(along[i]) - int(plain[i])) > 64 ? 1 : 0;
  }
  REQUIRE(inked > 50);
  // The same glyphs in the same places, give or take antialiasing at their edges.
  CHECK(differ < inked / 20);
}
