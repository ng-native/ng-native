// Text anchors and text along a path in the core's SVG model (svg.h): where drawSvg asks the
// canvas to draw each run, or each glyph on a path. The recorder measures ten points a byte.
#include "ngn/svg.h"
#include "svg-recorder.h"

#include <doctest/doctest.h>

#include <cmath>
#include <sstream>
#include <string>
#include <vector>

using ngn::SvgBrush;
using ngn::SvgElement;
using ngn::SvgKind;
using ngn::SvgLength;
using ngn::SvgNode;

namespace {

SvgLength len(double v) {
  return {.value = v, .set = true};
}
SvgLength pct(double v) {
  return {.value = v, .unit = SvgLength::Unit::Percent, .set = true};
}
SvgNode node(SvgElement element, std::vector<SvgNode> children = {}) {
  return {.element = std::move(element), .children = std::move(children)};
}
SvgElement svg() {
  return {.kind = SvgKind::Svg};
}
SvgElement text(double x, double y, std::string anchor = "") {
  SvgElement e{.kind = SvgKind::Text};
  e.xs = {len(x)};
  e.ys = {len(y)};
  e.textAnchor = std::move(anchor);
  return e;
}
SvgElement span(std::string content) {
  return {.kind = SvgKind::TSpan, .content = std::move(content)};
}

// The text calls, and on a path each glyph's and the transform it is drawn in before it.
std::vector<std::string> texts(SvgNode root) {
  Recorder canvas;
  ngn::drawSvg({.root = std::move(root)}, 200, 200, canvas);
  std::vector<std::string> out;
  for (const auto &c : canvas.calls) {
    if (c.rfind("text", 0) == 0 || c.rfind("glyphs", 0) == 0 || c.rfind("concat", 0) == 0) {
      out.push_back(c);
    }
  }
  return out;
}

// `content` along the path `d`, named "p" in the svg's defs.
SvgNode onPath(const std::string &d, SvgElement path, std::vector<SvgNode> spans, SvgElement shape = {.kind = SvgKind::Path}) {
  shape.name = "p";
  if (shape.kind == SvgKind::Path) {
    shape.d = d;
  }
  path.kind = SvgKind::TextPath;
  if (path.href.empty()) {
    path.href = "p";
  }
  return node(
      svg(), {node({.kind = SvgKind::Defs}, {node(shape)}), node({.kind = SvgKind::Text}, {node(path, std::move(spans))})});
}

} // namespace

TEST_CASE("text-anchor middle and end set a text back by half and all of its advance") {
  CHECK(texts(node(svg(), {node(text(50, 20), {node(span("abcd"))})})) == std::vector<std::string>{"text 'abcd' 50,20 12 #ff000000"});
  CHECK(texts(node(svg(), {node(text(50, 20, "start"), {node(span("abcd"))})})) == std::vector<std::string>{"text 'abcd' 50,20 12 #ff000000"});
  CHECK(texts(node(svg(), {node(text(50, 20, "middle"), {node(span("abcd"))})})) == std::vector<std::string>{"text 'abcd' 30,20 12 #ff000000"});
  CHECK(texts(node(svg(), {node(text(50, 20, "end"), {node(span("abcd"))})})) == std::vector<std::string>{"text 'abcd' 10,20 12 #ff000000"});
}

TEST_CASE("an anchor sets back the whole chunk, every span in it, by the anchor of the chunk's first characters") {
  SvgElement b = span("cd");
  b.dxs = {len(2)};
  // The chunk is 42 long with the gap: it starts at 50 - 21.
  CHECK(texts(node(svg(), {node(text(50, 20, "middle"), {node(span("ab")), node(b)})})) ==
        std::vector<std::string>{"text 'ab' 29,20 12 #ff000000", "text 'cd' 51,20 12 #ff000000"});
  // A later span's own anchor does not move a chunk it did not start.
  SvgElement start = span("cd");
  start.textAnchor = "start";
  CHECK(texts(node(svg(), {node(text(50, 20, "end"), {node(span("ab")), node(start)})})) ==
        std::vector<std::string>{"text 'ab' 10,20 12 #ff000000", "text 'cd' 30,20 12 #ff000000"});
}

TEST_CASE("a span placed by its own x or y starts a chunk of its own, anchored by its own anchor") {
  SvgElement second = span("cdef");
  second.xs = {len(50)};
  second.ys = {len(40)};
  second.textAnchor = "end";
  CHECK(texts(node(svg(), {node(text(50, 20, "middle"), {node(span("ab")), node(second)})})) ==
        std::vector<std::string>{"text 'ab' 40,20 12 #ff000000", "text 'cdef' 10,40 12 #ff000000"});
  // A y alone starts one too, from where the last ended before it was anchored.
  SvgElement lower = span("cd");
  lower.ys = {len(40)};
  CHECK(texts(node(svg(), {node(text(50, 20, "middle"), {node(span("ab")), node(lower)})})) ==
        std::vector<std::string>{"text 'ab' 40,20 12 #ff000000", "text 'cd' 60,40 12 #ff000000"});
  // And an x alone.
  SvgElement further = span("cd");
  further.xs = {len(100)};
  CHECK(texts(node(svg(), {node(text(50, 20, "middle"), {node(span("ab")), node(further)})})) ==
        std::vector<std::string>{"text 'ab' 40,20 12 #ff000000", "text 'cd' 90,20 12 #ff000000"});
}

TEST_CASE("text-anchor is inherited from a group, and the text's own wins over it") {
  SvgElement group{.kind = SvgKind::Group};
  group.textAnchor = "end";
  CHECK(texts(node(svg(), {node(group, {node(text(50, 20), {node(span("ab"))})})})) ==
        std::vector<std::string>{"text 'ab' 30,20 12 #ff000000"});
  CHECK(texts(node(svg(), {node(group, {node(text(50, 20, "middle"), {node(span("ab"))})})})) ==
        std::vector<std::string>{"text 'ab' 40,20 12 #ff000000"});
}

TEST_CASE("an unfilled span draws nothing but still takes its place in the chunk") {
  SvgElement hidden = span("ab");
  hidden.fill = {.type = SvgBrush::Type::None};
  hidden.propList = {"fill"};
  CHECK(texts(node(svg(), {node(text(50, 20, "middle"), {node(hidden), node(span("c"))})})) ==
        std::vector<std::string>{"text 'c' 55,20 12 #ff000000"});
}

TEST_CASE("text on a path draws each glyph at its middle's point along the path, turned with it") {
  CHECK(texts(onPath("M10 50 H110", {}, {node(span("ab"))})) ==
        std::vector<std::string>{
            "concat 1 0 0 1 15 50", "glyphs 'a' -5,0 #ff000000", "concat 1 0 0 1 25 50", "glyphs 'b' -5,0 #ff000000"});
  CHECK(texts(onPath("M10 0 V100", {}, {node(span("a"))})) == std::vector<std::string>{"concat 0 1 -1 0 10 5", "glyphs 'a' -5,0 #ff000000"});
  // Round a corner: the second glyph's middle is past it, on the way down.
  CHECK(texts(onPath("M0 0 H10 V100", {}, {node(span("abc"))}))[2] == "concat 0 1 -1 0 10 5");
  // A glyph whose middle is on the corner turns with the line after it, as in Chrome, here the
  // line that closes the path back to its start.
  SvgElement along{};
  along.lengths = {{"startOffset", len(5)}};
  CHECK(texts(onPath("M0 50 H10 Z", along, {node(span("a"))})) == std::vector<std::string>{"concat -1 0 0 -1 10 50", "glyphs 'a' -5,0 #ff000000"});
}

TEST_CASE("startOffset moves the text along the path, as a length or a share of the path's") {
  SvgElement along{};
  along.lengths = {{"startOffset", len(20)}};
  CHECK(texts(onPath("M10 50 H110", along, {node(span("a"))}))[0] == "concat 1 0 0 1 35 50");
  along.lengths = {{"startOffset", pct(50)}};
  CHECK(texts(onPath("M10 50 H110", along, {node(span("a"))}))[0] == "concat 1 0 0 1 65 50");
}

TEST_CASE("text-anchor on a path sets the text back from startOffset along it") {
  SvgElement along{};
  along.lengths = {{"startOffset", pct(50)}};
  along.textAnchor = "middle";
  CHECK(texts(onPath("M10 50 H110", along, {node(span("ab"))})) ==
        std::vector<std::string>{
            "concat 1 0 0 1 55 50", "glyphs 'a' -5,0 #ff000000", "concat 1 0 0 1 65 50", "glyphs 'b' -5,0 #ff000000"});
  along.textAnchor = "end";
  CHECK(texts(onPath("M10 50 H110", along, {node(span("ab"))}))[0] == "concat 1 0 0 1 45 50");
}

TEST_CASE("a glyph whose middle is off either end of the path, or on its very end, is not drawn, as in Chrome") {
  CHECK(texts(onPath("M0 50 H15", {}, {node(span("ab"))})) == std::vector<std::string>{"concat 1 0 0 1 5 50", "glyphs 'a' -5,0 #ff000000"});
  SvgElement before{};
  before.lengths = {{"startOffset", len(-8)}};
  CHECK(texts(onPath("M0 50 H100", before, {node(span("ab"))})) == std::vector<std::string>{"concat 1 0 0 1 7 50", "glyphs 'b' -5,0 #ff000000"});
}

TEST_CASE("side right sets the text along the path reversed") {
  SvgElement right{};
  right.side = "right";
  CHECK(texts(onPath("M0 50 H100", right, {node(span("a"))})) == std::vector<std::string>{"concat -1 0 0 -1 95 50", "glyphs 'a' -5,0 #ff000000"});
}

TEST_CASE("a span on a path: dx moves it along, dy off the path") {
  SvgElement moved = span("a");
  moved.dxs = {len(10)};
  moved.dys = {len(-4)};
  CHECK(texts(onPath("M0 50 H100", {}, {node(moved)})) == std::vector<std::string>{"concat 1 0 0 1 15 50", "glyphs 'a' -5,-4 #ff000000"});
}

TEST_CASE("a span on a path: x is a new place along it from startOffset, and y places nothing") {
  SvgElement along{};
  along.lengths = {{"startOffset", len(10)}};
  SvgElement placed = span("c");
  placed.xs = {len(40)};
  placed.ys = {len(20)};
  CHECK(texts(onPath("M0 50 H100", along, {node(span("ab")), node(placed)})) ==
        std::vector<std::string>{
            "concat 1 0 0 1 15 50",
            "glyphs 'a' -5,0 #ff000000",
            "concat 1 0 0 1 25 50",
            "glyphs 'b' -5,0 #ff000000",
            "concat 1 0 0 1 55 50",
            "glyphs 'c' -5,0 #ff000000"});
}

TEST_CASE("text on a curve: the glyph in the middle of an arch sits on top of it, level") {
  SvgElement along{};
  along.lengths = {{"startOffset", pct(50)}};
  along.textAnchor = "middle";
  auto calls = texts(onPath("M0 50 A50 50 0 0 1 100 50", along, {node(span("a"))}));
  REQUIRE(calls.size() == 2);
  std::istringstream concat(calls[0].substr(std::string("concat ").size()));
  double a, b, c, d, e, f;
  concat >> a >> b >> c >> d >> e >> f;
  // Level within a degree: the curve is followed as short lines.
  CHECK(a == doctest::Approx(1).epsilon(0.001));
  CHECK(std::abs(b) < 0.02);
  CHECK(e == doctest::Approx(50).epsilon(0.002));
  CHECK(std::abs(f) < 0.1);
  // A quarter of the way round, it leans in at 45 degrees.
  along.lengths = {{"startOffset", pct(25)}};
  std::istringstream quarter(texts(onPath("M0 50 A50 50 0 0 1 100 50", along, {node(span("a"))}))[0].substr(7));
  quarter >> a >> b >> c >> d >> e >> f;
  CHECK(a == doctest::Approx(std::sqrt(0.5)).epsilon(0.02));
  CHECK(b == doctest::Approx(-std::sqrt(0.5)).epsilon(0.02));
  CHECK(e == doctest::Approx(50 - 50 * std::sqrt(0.5)).epsilon(0.01));
  CHECK(f == doctest::Approx(50 - 50 * std::sqrt(0.5)).epsilon(0.01));
}

TEST_CASE("the path's own transform places the text, and a missing path or one that is no shape draws nothing") {
  SvgElement shifted{.kind = SvgKind::Path};
  shifted.matrix = ngn::SvgMatrix::translate(0, 10);
  CHECK(texts(onPath("M0 50 H100", {}, {node(span("a"))}, shifted))[0] == "concat 1 0 0 1 5 60");
  SvgElement missing{};
  missing.href = "nowhere";
  CHECK(texts(onPath("M0 50 H100", missing, {node(span("a"))})).empty());
  CHECK(texts(onPath("", {}, {node(span("a"))}, {.kind = SvgKind::Group})).empty());
  // Nor does a textPath inside another, as in Chrome.
  CHECK(texts(onPath("M0 50 H100", {}, {node({.kind = SvgKind::TextPath, .href = "p"}, {node(span("a"))})})).empty());
}

TEST_CASE("a glyph on a path is drawn as the canvas clusters it, a base and its vowel sign in one call") {
  // Devanagari ka (U+0915) and its dependent vowel sign i (U+093F), one grapheme cluster, then x.
  auto calls = texts(onPath("M0 50 H100", {}, {node(span("\xe0\xa4\x95\xe0\xa4\xbf" "x"))}));
  CHECK(calls == std::vector<std::string>{
                     "concat 1 0 0 1 30 50",
                     "glyphs '\xe0\xa4\x95\xe0\xa4\xbf' -30,0 #ff000000",
                     "concat 1 0 0 1 65 50",
                     "glyphs 'x' -5,0 #ff000000"});
}

TEST_CASE("a glyph on a path is placed where the shaped run has it, so a kerned pair keeps its kerning") {
  // The recorder kerns A and V together by three points: V starts at 7, not at A's own advance.
  CHECK(texts(onPath("M0 50 H100", {}, {node(span("AV"))})) ==
        std::vector<std::string>{
            "concat 1 0 0 1 5 50", "glyphs 'A' -5,0 #ff000000", "concat 1 0 0 1 12 50", "glyphs 'V' -5,0 #ff000000"});
}

TEST_CASE("text after a path carries on from the path's end, as Chrome places it") {
  CHECK(texts(node(
            svg(),
            {node({.kind = SvgKind::Defs}, {node({.kind = SvgKind::Path, .name = "p", .d = "M10 50 V150"})}),
             node({.kind = SvgKind::Text}, {node({.kind = SvgKind::TextPath, .href = "p"}, {node(span("ab"))}), node(span("c"))})}))
            .back() == "text 'c' 10,150 12 #ff000000");
}

TEST_CASE("a textPath's or a span's opacity composites all it holds as one, and 0 draws nothing") {
  auto drawn = [](double pathOpacity, double spanOpacity) {
    SvgElement along{};
    along.opacity = pathOpacity;
    SvgElement inner = span("a");
    inner.opacity = spanOpacity;
    Recorder canvas;
    ngn::drawSvg({.root = onPath("M0 50 H100", along, {node(inner)})}, 200, 200, canvas);
    std::vector<std::string> out;
    for (const auto &c : canvas.calls) {
      if (c.rfind("text", 0) == 0 || c.rfind("glyphs", 0) == 0 || c.rfind("layer", 0) == 0 || c == "end layer") {
        out.push_back(c);
      }
    }
    return out;
  };
  CHECK(drawn(0, 1).empty());
  CHECK(drawn(1, 0).empty());
  CHECK(drawn(0.5, 1) == std::vector<std::string>{"layer 0.5", "glyphs 'a' -5,0 #ff000000", "end layer"});
  // Nested, each composites its own: a layer in a layer.
  CHECK(drawn(0.5, 0.5) ==
        std::vector<std::string>{"layer 0.5", "layer 0.5", "glyphs 'a' -5,0 #ff000000", "end layer", "end layer"});
  CHECK(drawn(1, 1) == std::vector<std::string>{"glyphs 'a' -5,0 #ff000000"});
  // Off a path too: a span's opacity in a text.
  SvgElement faint = span("b");
  faint.opacity = 0.5;
  Recorder canvas;
  ngn::drawSvg({.root = node(svg(), {node(text(0, 20), {node(faint), node(span("c"))})})}, 200, 200, canvas);
  std::vector<std::string> out;
  for (const auto &c : canvas.calls) {
    if (c.rfind("text", 0) == 0 || c.rfind("glyphs", 0) == 0 || c.rfind("layer", 0) == 0 || c == "end layer") {
      out.push_back(c);
    }
  }
  // The span after it is drawn whole again.
  CHECK(out == std::vector<std::string>{"layer 0.5", "text 'b' 0,20 12 #ff000000", "end layer", "text 'c' 10,20 12 #ff000000"});
}

TEST_CASE("spans that overlap under a textPath at opacity 0.5 are drawn in one layer, so the overlap stays at 0.5") {
  SvgElement along{};
  along.opacity = 0.5;
  SvgElement first = span("a"), second = span("b");
  first.xs = {len(0)};
  second.xs = {len(0)};
  Recorder canvas;
  ngn::drawSvg({.root = onPath("M0 50 H100", along, {node(first), node(second)})}, 200, 200, canvas);
  std::vector<std::string> out;
  for (const auto &c : canvas.calls) {
    if (c.rfind("glyphs", 0) == 0 || c.rfind("layer", 0) == 0 || c == "end layer") {
      out.push_back(c);
    }
  }
  CHECK(out == std::vector<std::string>{"layer 0.5", "glyphs 'a' -5,0 #ff000000", "glyphs 'b' -5,0 #ff000000", "end layer"});
  // Two faint spans side by side are two groups, a layer each.
  SvgElement faintA = span("a"), faintB = span("b");
  faintA.opacity = faintB.opacity = 0.5;
  Recorder siblings;
  ngn::drawSvg({.root = node(svg(), {node(text(0, 20), {node(faintA), node(faintB)})})}, 200, 200, siblings);
  std::vector<std::string> drawnSiblings;
  for (const auto &c : siblings.calls) {
    if (c.rfind("text", 0) == 0 || c.rfind("layer", 0) == 0 || c == "end layer") {
      drawnSiblings.push_back(c);
    }
  }
  CHECK(drawnSiblings ==
        std::vector<std::string>{
            "layer 0.5", "text 'a' 0,20 12 #ff000000", "end layer", "layer 0.5", "text 'b' 10,20 12 #ff000000", "end layer"});
}

TEST_CASE("dx and dy on the text before its textPath move the first glyph along and off the path, as Chrome places them") {
  // As Chrome's getStartPositionOfChar has them for the same SVG.
  auto onPathFrom = [](SvgElement outer, std::vector<SvgNode> spans) {
    return node(
        svg(),
        {node({.kind = SvgKind::Defs}, {node({.kind = SvgKind::Path, .name = "p", .d = "M0 50 H100"})}),
         node(outer, {node({.kind = SvgKind::TextPath, .href = "p"}, std::move(spans))})});
  };
  SvgElement moved{.kind = SvgKind::Text};
  moved.dxs = {len(10)};
  moved.dys = {len(-4)};
  CHECK(texts(onPathFrom(moved, {node(span("a"))})) == std::vector<std::string>{"concat 1 0 0 1 15 50", "glyphs 'a' -5,-4 #ff000000"});
  // The text's own x is a place along the path too, and its y places nothing.
  SvgElement placed = moved;
  placed.xs = {len(30)};
  placed.ys = {len(20)};
  CHECK(texts(onPathFrom(placed, {node(span("a"))})) == std::vector<std::string>{"concat 1 0 0 1 45 50", "glyphs 'a' -5,-4 #ff000000"});
  // A span's own dx and dy for the same glyph win over the text's.
  SvgElement inner = span("a");
  inner.dxs = {len(3)};
  inner.dys = {len(2)};
  CHECK(texts(onPathFrom(moved, {node(inner)})) == std::vector<std::string>{"concat 1 0 0 1 8 50", "glyphs 'a' -5,2 #ff000000"});
}

TEST_CASE("the innermost x, y, dx or dy for a character places it, and one on a span with no characters places nothing") {
  // As Chrome places them.
  SvgElement outer = text(0, 100);
  outer.dxs = {len(10)};
  outer.dys = {len(5)};
  SvgElement inner = span("ab");
  inner.dxs = {len(3)};
  inner.dys = {len(2)};
  CHECK(texts(node(svg(), {node(outer, {node(inner)})})) == std::vector<std::string>{"text 'ab' 3,102 12 #ff000000"});
  SvgElement empty{.kind = SvgKind::TSpan};
  empty.dxs = {len(3)};
  empty.xs = {len(50)};
  empty.ys = {len(7)};
  CHECK(texts(node(svg(), {node(outer, {node(empty), node(span("ab"))})})) == std::vector<std::string>{"text 'ab' 10,105 12 #ff000000"});
}

TEST_CASE("the recorder counts glyphs on a path as drawn") {
  Recorder canvas;
  ngn::drawSvg({.root = onPath("M0 50 H100", {}, {node(span("a"))})}, 200, 200, canvas);
  CHECK(canvas.drawn() == std::vector<std::string>{"glyphs 'a' -5,0 #ff000000"});
}
