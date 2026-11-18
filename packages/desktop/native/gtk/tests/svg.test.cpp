// An svg mounted into GTK: its document, which the core builds from react-native-svg's elements,
// drawn by the cairo canvas into the svg view's snapshot. Read from the pixels the window draws.
#include "../cairo-canvas.h"
#include "mounted-views.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using folly::dynamic;
using ngn::SvgBrush;
using ngn::SvgElement;
using ngn::SvgKind;
using ngn::SvgLength;
using ngn::SvgNode;
using ngn::testing::bluish;
using ngn::testing::desktopViewProps;
using ngn::testing::greenish;
using ngn::testing::MountedViews;
using ngn::testing::reddish;

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

SvgNode node(SvgElement element, std::vector<SvgNode> children = {}) {
  return {.element = std::move(element), .children = std::move(children)};
}

// An svg with a 24 by 24 viewBox, as an icon's.
SvgElement icon() {
  SvgElement e{.kind = SvgKind::Svg};
  e.vbWidth = 24;
  e.vbHeight = 24;
  e.align = "xMidYMid";
  return e;
}

SvgElement rect(double x, double y, double w, double h, std::optional<uint32_t> fill = std::nullopt) {
  SvgElement e{.kind = SvgKind::Rect};
  e.lengths = {{"x", len(x)}, {"y", len(y)}, {"width", len(w)}, {"height", len(h)}};
  if (fill) {
    e.fill = color(*fill);
    e.propList = {"fill"};
  }
  return e;
}

// An svg view of 96 by 96 at (0, 0), drawing `root`.
void mountSvg(MountedViews &views, SvgNode root) {
  views.add(MountedViews::shadow(2, "RNSVGSvgView", desktopViewProps(dynamic::object()), {{0, 0}, {96, 96}}));
  views.backend->setSvgDrawing(MountedViews::kSurface, 2, std::make_shared<const ngn::SvgDocument>(ngn::SvgDocument{.root = std::move(root)}));
  views.settle();
}

} // namespace

TEST_CASE("an svg draws its shapes, scaled from its viewBox to its view") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  mountSvg(views, node(icon(), {node(rect(0, 0, 12, 24, 0xffff0000)), node(rect(12, 0, 12, 24, 0xff0000ff))}));
  // Each half of the viewBox is half the view: 48 points.
  CHECK(reddish(views.pixel(20, 48)));
  CHECK(reddish(views.pixel(44, 48)));
  CHECK(bluish(views.pixel(52, 48)));
  CHECK(bluish(views.pixel(90, 48)));
}

TEST_CASE("an svg strokes a path in an icon's line, in currentColor") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  SvgElement line{.kind = SvgKind::Path};
  line.d = "M4 12H20";
  line.stroke = {.type = SvgBrush::Type::CurrentColor};
  line.fill = {.type = SvgBrush::Type::None};
  line.strokeWidth = len(4);
  line.strokeLinecap = 1;
  line.propList = {"stroke", "fill", "strokeWidth", "strokeLinecap"};
  auto root = icon();
  root.color = 0xff00ff00;
  mountSvg(views, node(root, {node(line)}));
  CHECK(greenish(views.pixel(48, 48)));
  // The round cap reaches past the end by half the width: 2 units, 8 points.
  CHECK(greenish(views.pixel(84, 48)));
  CHECK(views.pixel(48, 30).a == 0);
  CHECK(views.pixel(94, 48).a == 0);
}

TEST_CASE("an svg fills with a gradient, and draws a group at its opacity") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  SvgElement gradient{.kind = SvgKind::LinearGradient, .name = "g"};
  gradient.lengths = {{"x1", pct(0)}, {"y1", pct(0)}, {"x2", pct(100)}, {"y2", pct(0)}};
  gradient.stops = {{0, 0xffff0000}, {1, 0xff0000ff}};
  auto filled = rect(0, 0, 24, 12);
  filled.fill = {.type = SvgBrush::Type::Ref, .ref = "g"};
  filled.propList = {"fill"};
  SvgElement group{.kind = SvgKind::Group};
  group.opacity = 0.5;
  mountSvg(views, node(icon(), {node({.kind = SvgKind::Defs}, {node(gradient)}), node(filled), node(group, {node(rect(0, 12, 24, 12, 0xff00ff00))})}));
  CHECK(reddish(views.pixel(2, 20)));
  CHECK(bluish(views.pixel(93, 20)));
  auto half = views.pixel(48, 72);
  CHECK(half.g > 200);
  CHECK(half.a > 100);
  CHECK(half.a < 160);
}

TEST_CASE("an svg draws an element through its mask") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  SvgElement mask{.kind = SvgKind::Mask, .name = "m"};
  mask.units = 1;
  mask.lengths = {{"x", len(0)}, {"y", len(0)}, {"width", len(24)}, {"height", len(24)}};
  auto masked = rect(0, 0, 24, 24, 0xffff0000);
  masked.mask = "m";
  // White shows the element, black hides it.
  mountSvg(views, node(icon(), {node(mask, {node(rect(0, 0, 12, 24, 0xffffffff)), node(rect(12, 0, 12, 24, 0xff000000))}), node(masked)}));
  CHECK(reddish(views.pixel(24, 48)));
  CHECK(views.pixel(72, 48).a < 20);
}

TEST_CASE("an svg cuts an element to its clip path, and fills with a pattern's tiles") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  SvgElement clip{.kind = SvgKind::ClipPath, .name = "c"};
  auto clipped = rect(0, 0, 24, 12, 0xffff0000);
  clipped.clipPath = "c";
  // A pattern of 6 by 12 tiles, each green on its left half only.
  SvgElement pattern{.kind = SvgKind::Pattern, .name = "p"};
  pattern.units = 1;
  pattern.lengths = {{"x", len(0)}, {"y", len(0)}, {"width", len(6)}, {"height", len(12)}};
  auto tiled = rect(0, 12, 24, 12);
  tiled.fill = {.type = SvgBrush::Type::Ref, .ref = "p"};
  tiled.propList = {"fill"};
  mountSvg(views, node(icon(), {node(clip, {node(rect(0, 0, 12, 12))}), node(clipped), node(pattern, {node(rect(0, 0, 3, 12, 0xff00ff00))}), node(tiled)}));
  CHECK(reddish(views.pixel(24, 24)));
  CHECK(views.pixel(72, 24).a == 0);
  // Tiles every 24 points, green for the first 12 of each.
  CHECK(greenish(views.pixel(6, 72)));
  CHECK(views.pixel(18, 72).a == 0);
  CHECK(greenish(views.pixel(30, 72)));
  CHECK(greenish(views.pixel(78, 72)));
  CHECK(views.pixel(90, 72).a == 0);
}

TEST_CASE("an svg draws an element through its filter") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  SvgElement filter{.kind = SvgKind::Filter, .name = "f"};
  filter.units = 1;
  filter.contentUnits = 1;
  filter.lengths = {{"x", len(0)}, {"y", len(0)}, {"width", len(24)}, {"height", len(24)}};
  SvgElement offset{.kind = SvgKind::FeOffset};
  offset.lengths = {{"dx", len(12)}, {"dy", len(0)}};
  auto moved = rect(0, 0, 12, 24, 0xffff0000);
  moved.filter = "f";
  mountSvg(views, node(icon(), {node(filter, {node(offset)}), node(moved)}));
  // Moved right by half the view.
  CHECK(views.pixel(24, 48).a == 0);
  CHECK(reddish(views.pixel(72, 48)));
}

TEST_CASE("an svg draws its new document, and its elements' own views are hidden") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  mountSvg(views, node(icon(), {node(rect(0, 0, 24, 24, 0xffff0000))}));
  CHECK(reddish(views.pixel(48, 48)));
  views.add(MountedViews::shadow(3, "RNSVGRect", desktopViewProps(dynamic::object()), {{0, 0}, {96, 96}}), 2);
  CHECK_FALSE(gtk_widget_get_child_visible(views.view(3)));
  views.backend->setSvgDrawing(MountedViews::kSurface, 2, std::make_shared<const ngn::SvgDocument>(ngn::SvgDocument{.root = node(icon(), {node(rect(0, 0, 24, 24, 0xff0000ff))})}));
  views.settle();
  CHECK(bluish(views.pixel(48, 48)));
}

TEST_CASE("the cairo canvas measures text as Pango lays it out, and splits it into clusters in the order of the text") {
  cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, 10, 10);
  cairo_t *cr = cairo_create(surface);
  auto canvas = ngn::gtk::makeCairoCanvas(cr, 10, 10, 1);
  double one = canvas->measureText("W", 20, "", "");
  double three = canvas->measureText("WWW", 20, "", "");
  CHECK(one > 5);
  CHECK(three == doctest::Approx(one * 3).epsilon(0.05));
  auto clusters = canvas->glyphClusters("abc", 20, "", "");
  REQUIRE(clusters.size() == 3);
  CHECK(clusters[0].text == "a");
  CHECK(clusters[2].text == "c");
  CHECK(clusters[0].x == doctest::Approx(0));
  CHECK(clusters[1].x == doctest::Approx(clusters[0].advance));
  CHECK(clusters[2].x + clusters[2].advance == doctest::Approx(canvas->measureText("abc", 20, "", "")).epsilon(0.01));
  canvas.reset();
  cairo_destroy(cr);
  cairo_surface_destroy(surface);
}
