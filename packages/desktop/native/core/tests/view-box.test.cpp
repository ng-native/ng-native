#include "ngn/desktop-view-props.h"
#include "ngn/view-box.h"
#include "svg-recorder.h"

#include <doctest/doctest.h>

#include <algorithm>

using namespace facebook::react;
using folly::dynamic;
using Radii = ngn::CornerRadii;
using ngn::SvgPath;
using ngn::SvgRect;

namespace {

constexpr int64_t kRed = 0xffff0000;
constexpr int64_t kGreen = 0xff00ff00;
constexpr int64_t kBlue = 0xff0000ff;

struct Box {
  std::shared_ptr<const ContextContainer> context = std::make_shared<const ContextContainer>();
  ngn::DesktopViewComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  Props::Shared props;
  LayoutMetrics layout;

  Box(dynamic raw, double width, double height, LayoutDirection direction = LayoutDirection::LeftToRight) {
    props = descriptor.cloneProps(parserContext, nullptr, RawProps(std::move(raw)));
    layout.frame = {{0, 0}, {static_cast<Float>(width), static_cast<Float>(height)}};
    layout.layoutDirection = direction;
  }
  const ViewProps &view() const { return static_cast<const ViewProps &>(*props); }
  ngn::ViewBox box() const { return ngn::viewBox(view(), layout); }
  std::vector<std::string> drawn() const {
    Recorder canvas;
    ngn::drawViewBox(view(), layout, canvas);
    return canvas.calls;
  }
};

int cubics(const SvgPath &path) {
  return static_cast<int>(std::count_if(
      path.segments.begin(), path.segments.end(), [](const auto &s) { return s.op == SvgPath::Op::Cubic; }));
}

bool hasCall(const std::vector<std::string> &calls, const std::string &prefix) {
  return std::any_of(calls.begin(), calls.end(), [&](const std::string &c) { return c.rfind(prefix, 0) == 0; });
}

std::vector<std::string> fills(const std::vector<std::string> &calls) {
  std::vector<std::string> out;
  for (const auto &c : calls) {
    if (c.rfind("fill", 0) == 0 || c.rfind("stroke", 0) == 0) {
      out.push_back(c);
    }
  }
  return out;
}

} // namespace

TEST_CASE("a rounded rect with no radii is the rect, and its corners are curves where they have radii") {
  CHECK(Recorder::path(ngn::roundedRect({0, 0, 100, 50}, {})) == "M0,0L100,0L100,50L0,50L0,0Z");

  Radii radii;
  radii.topLeft = {10, 10};
  radii.bottomRight = {20, 5};
  auto path = ngn::roundedRect({0, 0, 100, 50}, radii);
  CHECK(cubics(path) == 2);
  CHECK(Recorder::path(path) == "M10,0L100,0L100,45C80,50L0,50L0,10C10,0Z");
}

TEST_CASE("a reversed rounded rect runs the other way round") {
  CHECK(Recorder::path(ngn::roundedRect({0, 0, 100, 50}, {}, true)) == "M0,0L0,50L100,50L100,0L0,0Z");
}

TEST_CASE("a radius is kept within what the opposite corner leaves on its side, as React Native iOS does") {
  Radii radii;
  radii.topLeft = {80, 10};
  radii.topRight = {40, 10};
  auto path = ngn::roundedRect({0, 0, 100, 50}, radii);
  // The top left's 80 across is cut to the 60 the top right leaves.
  CHECK(Recorder::path(path).rfind("M60,0", 0) == 0);
}

TEST_CASE("the inner radii are the outer less the sides' widths, never below 0") {
  Radii radii;
  radii.topLeft = {10, 10};
  radii.topRight = {3, 3};
  auto inner = ngn::innerRadii(radii, {.top = 4, .right = 5, .bottom = 0, .left = 2});
  CHECK(inner.topLeft == Radii::Corner{8, 6});
  CHECK(inner.topRight == Radii::Corner{0, 0});
}

TEST_CASE("a shadow's spread grows a radius by the spread, and a small radius by less") {
  Radii radii;
  radii.topLeft = {24, 24};
  radii.topRight = {4, 4};
  auto spread = ngn::spreadRadii(radii, -12);
  CHECK(spread.topLeft.x == doctest::Approx(12));
  // 4 is under the spread's 12: CSS adds 12 * (1 + (4/12 - 1)^3), which is 0 here once it shrinks.
  CHECK(spread.topRight.x == doctest::Approx(0));
  CHECK(ngn::spreadRadii(radii, 12).topRight.x == doctest::Approx(4 + 12 * (1 + std::pow(4.0 / 12 - 1, 3))));
  // No radius stays square.
  CHECK(ngn::spreadRadii({}, 10).bottomLeft.x == 0);
}

TEST_CASE("one radius and one solid border on a view that clips is Core Animation's, on the layer") {
  Box b(dynamic::object("borderRadius", 8)("borderWidth", 2)("borderColor", kBlue)("backgroundColor", kRed)("overflow", "hidden"), 100, 50);
  auto box = b.box();
  CHECK(box.layerDrawn);
  CHECK(box.cornerRadius == 8);
  CHECK(box.borderWidth == 2);
  CHECK(box.borderColor == 0xff0000ffu);
  CHECK(box.background == 0xffff0000u);
  CHECK_FALSE(box.drawn);
  CHECK_FALSE(box.clip);
  CHECK(b.drawn().empty());
}

TEST_CASE("a visible border on a view that does not clip is drawn under its children, as CSS has it") {
  Box b(dynamic::object("borderRadius", 8)("borderWidth", 2)("borderColor", kBlue)("backgroundColor", kRed), 100, 50);
  auto box = b.box();
  CHECK_FALSE(box.layerDrawn);
  CHECK(box.drawn);
  auto calls = fills(b.drawn());
  REQUIRE(calls.size() == 2);
  // The background in the border box's shape, then the ring between it and the padding box.
  CHECK(calls[0].rfind("fill M8,0", 0) == 0);
  CHECK(calls[0].find("#ffff0000") != std::string::npos);
  CHECK(calls[1].find("evenodd #ff0000ff") != std::string::npos);
}

TEST_CASE("a view with only a background and one radius stays on the layer") {
  Box b(dynamic::object("borderRadius", 12)("backgroundColor", kRed), 100, 50);
  auto box = b.box();
  CHECK(box.layerDrawn);
  CHECK(box.cornerRadius == 12);
  CHECK_FALSE(box.drawn);
}

TEST_CASE("corners with different radii draw the background in their shape") {
  Box b(dynamic::object("borderTopLeftRadius", 16)("borderBottomRightRadius", 4)("backgroundColor", kRed), 100, 50);
  auto box = b.box();
  CHECK_FALSE(box.layerDrawn);
  CHECK(box.cornerRadius == 0);
  CHECK_FALSE(box.background);
  auto calls = fills(b.drawn());
  REQUIRE(calls.size() == 1);
  CHECK(calls[0] == "fill M16,0L100,0L100,46C96,50L0,50L0,16C16,0Z #ffff0000");
}

TEST_CASE("a view that clips with corners that differ is masked to its border box's shape") {
  Box b(dynamic::object("borderTopLeftRadius", 16)("overflow", "hidden"), 100, 50);
  auto box = b.box();
  REQUIRE(box.clip);
  CHECK(Recorder::path(*box.clip) == "M16,0L100,0L100,50L0,50L0,16C16,0Z");
  Box round(dynamic::object("borderRadius", 16)("overflow", "hidden"), 100, 50);
  CHECK_FALSE(round.box().clip);
}

TEST_CASE("each side of a border draws in its own colour, in the trapezoid between its corners") {
  Box b(
      dynamic::object("borderTopWidth", 2)("borderTopColor", kRed)("borderRightWidth", 4)("borderRightColor", kGreen)(
          "borderBottomWidth", 6)("borderBottomColor", kBlue),
      100,
      50);
  auto calls = b.drawn();
  auto drawn = fills(calls);
  REQUIRE(drawn.size() == 3);
  // Clipped to the ring between the border box and the padding box first.
  CHECK(hasCall(calls, "clip M0,0L100,0L100,50L0,50L0,0ZM0,2L96,2L96,44L0,44L0,2Z evenodd"));
  CHECK(std::count_if(drawn.begin(), drawn.end(), [](auto &c) { return c.find("#ffff0000") != std::string::npos; }) == 1);
  CHECK(std::count_if(drawn.begin(), drawn.end(), [](auto &c) { return c.find("#ff00ff00") != std::string::npos; }) == 1);
  CHECK(std::count_if(drawn.begin(), drawn.end(), [](auto &c) { return c.find("#ff0000ff") != std::string::npos; }) == 1);
  // The right side runs from the box's corners to the padding box's.
  CHECK(std::find(drawn.begin(), drawn.end(), "fill M100,0L96,2L96,44L100,50Z #ff00ff00") != drawn.end());
}

TEST_CASE("sides that share a colour draw as one, so no seam shows where they meet") {
  Box b(dynamic::object("borderTopWidth", 2)("borderLeftWidth", 4)("borderColor", kRed), 100, 50);
  auto calls = b.drawn();
  auto drawn = fills(calls);
  REQUIRE(drawn.size() == 1);
  // The ring between the border box and the padding box, in one fill with no clip.
  CHECK(drawn[0] == "fill M0,0L100,0L100,50L0,50L0,0ZM4,2L100,2L100,50L4,50L4,2Z evenodd #ffff0000");
  CHECK_FALSE(hasCall(calls, "clip"));

  Box mixed(
      dynamic::object("borderTopWidth", 2)("borderLeftWidth", 4)("borderRightWidth", 4)("borderColor", kRed)(
          "borderRightColor", kBlue),
      100,
      50);
  auto mixedDrawn = fills(mixed.drawn());
  REQUIRE(mixedDrawn.size() == 2);
  // The top and the left in one path, so they meet with no seam between them.
  CHECK(mixedDrawn[1] == "fill M0,0L4,2L4,50L0,50ZM0,0L4,2L96,2L100,0Z #ffff0000");
}

TEST_CASE("border-inline-start draws on the start side only: the left, and the right from right to left") {
  dynamic raw = dynamic::object("borderStartWidth", 4)("borderStartColor", kRed);
  Box ltr(raw, 100, 50);
  auto drawn = fills(ltr.drawn());
  REQUIRE(drawn.size() == 1);
  CHECK(drawn[0] == "fill M0,0L100,0L100,50L0,50L0,0ZM4,0L100,0L100,50L4,50L4,0Z evenodd #ffff0000");
  CHECK_FALSE(ltr.box().layerDrawn);

  Box rtl(raw, 100, 50, LayoutDirection::RightToLeft);
  auto rtlDrawn = fills(rtl.drawn());
  REQUIRE(rtlDrawn.size() == 1);
  CHECK(rtlDrawn[0] == "fill M0,0L100,0L100,50L0,50L0,0ZM0,0L96,0L96,50L0,50L0,0Z evenodd #ffff0000");
}

TEST_CASE("a rounded corner's sides meet where the line from the corner crosses the inner curve") {
  Box b(
      dynamic::object("borderRadius", 20)("borderLeftWidth", 10)("borderLeftColor", kRed)("borderTopWidth", 10)(
          "borderTopColor", kBlue),
      100,
      100);
  auto drawn = fills(b.drawn());
  REQUIRE(drawn.size() == 2);
  // The inner corner's radius is 10 at (10, 10); the diagonal meets it at 10 + 10 * (1 - 1/sqrt 2).
  CHECK(drawn[0].find("L12.93,12.93") != std::string::npos);
}

TEST_CASE("a dashed border is a dashed stroke along the middle of the border, in one colour") {
  Box b(dynamic::object("borderWidth", 2)("borderColor", kRed)("borderStyle", "dashed"), 100, 50);
  CHECK_FALSE(b.box().layerDrawn);
  auto drawn = fills(b.drawn());
  REQUIRE(drawn.size() == 1);
  CHECK(drawn[0] == "stroke M1,1L99,1L99,49L1,49L1,1Z w2 cap0 join0 dash 6 6 #ffff0000");
}

TEST_CASE("a transparent or zero border is not drawn") {
  Box clear(dynamic::object("borderWidth", 2)("borderColor", 0)("borderTopLeftRadius", 4), 100, 50);
  CHECK(fills(clear.drawn()).empty());
  Box none(dynamic::object("borderTopLeftRadius", 4)("borderTopColor", kRed), 100, 50);
  CHECK(fills(none.drawn()).empty());
}

TEST_CASE("a linear gradient runs along CSS's gradient line, corner to corner at 135 degrees on a square") {
  auto stops = dynamic::array(
      dynamic::object("color", kRed)("position", nullptr),
      dynamic::object("color", kBlue)("position", "60%"),
      dynamic::object("color", kGreen)("position", nullptr));
  Box b(
      dynamic::object(
          "experimental_backgroundImage",
          dynamic::array(dynamic::object("type", "linear-gradient")("direction", dynamic::object("type", "angle")("value", 135))(
              "colorStops", stops))),
      100,
      100);
  auto box = b.box();
  CHECK(box.layerDrawn);
  CHECK(box.drawn);
  auto calls = b.drawn();
  auto drawn = fills(calls);
  REQUIRE(drawn.size() == 1);
  CHECK(drawn[0] == "fill M0,0L100,0L100,100L0,100L0,0Z linear(0,0 100,100 stops3 t1,1,0,0)");

  const auto &image = std::get<LinearGradient>(b.view().backgroundImage[0]);
  auto g = ngn::linearGradient(image, 100, 100);
  REQUIRE(g.stops.size() == 3);
  CHECK(g.stops[0] == std::pair<double, uint32_t>{0, 0xffff0000});
  CHECK(g.stops[1].first == doctest::Approx(0.6));
  CHECK(g.stops[2] == std::pair<double, uint32_t>{1, 0xff00ff00});
}

TEST_CASE("a linear gradient's line ends at the corners for any angle, and at the edges for a side") {
  LinearGradient toBottom{.direction = Float{180}, .colorStops = {}};
  auto g = ngn::linearGradient(toBottom, 200, 50);
  CHECK(g.x1 == doctest::Approx(0));
  CHECK(g.y1 == doctest::Approx(0));
  CHECK(g.y2 == doctest::Approx(50));
  CHECK(g.x2 == doctest::Approx(0));
  LinearGradient toRight{.direction = Float{90}, .colorStops = {}};
  g = ngn::linearGradient(toRight, 200, 50);
  CHECK(g.x2 == doctest::Approx(200));
  CHECK(g.y2 == doctest::Approx(0));
  // 45 degrees on 200 by 50: the line through the centre is |200 sin 45| + |50 cos 45| long.
  LinearGradient angled{.direction = Float{45}, .colorStops = {}};
  g = ngn::linearGradient(angled, 200, 50);
  CHECK(std::hypot(g.x2 - g.x1, g.y2 - g.y1) == doctest::Approx(250 * std::sqrt(0.5)));
  CHECK((g.x1 + g.x2) / 2 == doctest::Approx(100));
  CHECK((g.y1 + g.y2) / 2 == doctest::Approx(25));
  CHECK(g.y2 < g.y1);
}

TEST_CASE("a gradient keyword to a corner aims the line so the other two corners share a colour") {
  LinearGradient toTopRight{.direction = GradientKeyword::ToTopRight, .colorStops = {}};
  auto g = ngn::linearGradient(toTopRight, 200, 100);
  // Perpendicular to the diagonal between the other two corners, top left and bottom right.
  double dx = g.x2 - g.x1, dy = g.y2 - g.y1;
  CHECK(dx * 200 + dy * 100 == doctest::Approx(0).epsilon(0.001));
  CHECK(dx > 0);
  CHECK(dy < 0);
}

TEST_CASE("gradient stops: lengths along the line, ones out of order held, and missing ones spread") {
  std::vector<ColorStop> stops{
      {.color = colorFromRGBA(255, 0, 0, 255), .position = ValueUnit(50, UnitType::Point)},
      {.color = colorFromRGBA(0, 255, 0, 255), .position = ValueUnit(10, UnitType::Percent)},
      {.color = colorFromRGBA(0, 0, 255, 255), .position = {}},
      {.color = colorFromRGBA(0, 0, 0, 255), .position = {}},
  };
  auto out = ngn::gradientStops(stops, 200);
  REQUIRE(out.size() == 4);
  CHECK(out[0].first == doctest::Approx(0.25));
  // 10% is before 25%, so it is held at 25%.
  CHECK(out[1].first == doctest::Approx(0.25));
  CHECK(out[2].first == doctest::Approx(0.625));
  CHECK(out[3].first == doctest::Approx(1));
}

TEST_CASE("a colour hint stands for the curve of colours between its stops") {
  std::vector<ColorStop> stops{
      {.color = colorFromRGBA(0, 0, 0, 255), .position = ValueUnit(0, UnitType::Percent)},
      {.color = {}, .position = ValueUnit(20, UnitType::Percent)},
      {.color = colorFromRGBA(255, 255, 255, 255), .position = ValueUnit(100, UnitType::Percent)},
  };
  auto out = ngn::gradientStops(stops, 100);
  CHECK(out.size() == 11);
  // Half way between the colours at the hint.
  auto at = std::find_if(out.begin(), out.end(), [](auto &s) { return std::abs(s.first - 0.2) < 0.001; });
  REQUIRE(at != out.end());
  CHECK(double((at->second >> 16) & 0xff) == doctest::Approx(127.5).epsilon(0.01));
  for (const auto &s : out) {
    CHECK((s.second >> 24) == 0xffu);
  }
}

TEST_CASE("stops past the ends move the gradient's ends out instead of being cut off") {
  LinearGradient g{
      .direction = Float{90},
      .colorStops = {
          {.color = colorFromRGBA(255, 0, 0, 255), .position = ValueUnit(-50, UnitType::Percent)},
          {.color = colorFromRGBA(0, 0, 255, 255), .position = ValueUnit(150, UnitType::Percent)},
      }};
  auto out = ngn::linearGradient(g, 100, 10);
  CHECK(out.x1 == doctest::Approx(-50));
  CHECK(out.x2 == doctest::Approx(150));
  CHECK(out.stops[0].first == doctest::Approx(0));
  CHECK(out.stops[1].first == doctest::Approx(1));
}

TEST_CASE("a radial gradient: a circle to its farthest corner from where it is placed") {
  RadialGradient g{
      .shape = RadialGradientShape::Circle,
      .size = {.value = RadialGradientSize::SizeKeyword::FarthestCorner},
      .position = {.top = ValueUnit(10, UnitType::Percent), .left = ValueUnit(90, UnitType::Percent)},
      .colorStops = {
          {.color = colorFromRGBA(255, 255, 255, 90), .position = ValueUnit(0, UnitType::Percent)},
          {.color = colorFromRGBA(0, 0, 0, 0), .position = ValueUnit(45, UnitType::Percent)}}};
  auto out = ngn::radialGradient(g, 100, 100);
  REQUIRE(out);
  CHECK(out->radial);
  CHECK(out->r == doctest::Approx(std::hypot(90, 90)));
  CHECK(out->transform.e == doctest::Approx(90));
  CHECK(out->transform.f == doctest::Approx(10));
  CHECK(out->transform.d == doctest::Approx(1));
  CHECK(out->stops[1].first == doctest::Approx(0.45));
}

TEST_CASE("a radial gradient: an ellipse keeps the box's proportions out to the farthest corner") {
  RadialGradient g{
      .shape = RadialGradientShape::Ellipse,
      .size = {.value = RadialGradientSize::SizeKeyword::FarthestCorner},
      .position = {},
      .colorStops = {}};
  auto out = ngn::radialGradient(g, 200, 100);
  REQUIRE(out);
  CHECK(out->r == doctest::Approx(100 * std::sqrt(2.0)));
  CHECK(out->transform.d == doctest::Approx(0.5));
  CHECK(out->transform.e == doctest::Approx(100));
  CHECK(out->transform.f == doctest::Approx(50));
  RadialGradient closest{
      .shape = RadialGradientShape::Ellipse,
      .size = {.value = RadialGradientSize::SizeKeyword::ClosestSide},
      .position = {.top = ValueUnit(0, UnitType::Point), .left = ValueUnit(0, UnitType::Point)},
      .colorStops = {}};
  CHECK_FALSE(ngn::radialGradient(closest, 200, 100));
}

TEST_CASE("one background image with nothing placing it fills the padding box once") {
  auto tiles = ngn::backgroundTiles({0, 0, 100, 50}, {0, 0, 100, 50}, BackgroundSizeLengthPercentage{}, BackgroundPosition{}, BackgroundRepeat{});
  REQUIRE(tiles.size() == 1);
  CHECK(tiles[0] == SvgRect{0, 0, 100, 50});
}

TEST_CASE("background tiles repeat over the border box from where the padding box places them") {
  BackgroundSizeLengthPercentage half;
  half.x = ValueUnit(50, UnitType::Percent);
  half.y = ValueUnit(100, UnitType::Percent);
  auto tiles = ngn::backgroundTiles({2, 2, 96, 46}, {0, 0, 100, 50}, half, BackgroundPosition{}, BackgroundRepeat{});
  // 48 wide from x 2: one before it reaches the border at 0, and three to the right edge; 46 high
  // from y 2: one above and two below.
  REQUIRE(tiles.size() == 4 * 3);
  CHECK(tiles[0].x == doctest::Approx(-46));
  CHECK(tiles[0].y == doctest::Approx(-44));
  CHECK(tiles[3].x == doctest::Approx(98));
  CHECK(tiles[0].width == doctest::Approx(48));

  BackgroundRepeat once;
  once.x = once.y = BackgroundRepeatStyle::NoRepeat;
  BackgroundPosition right;
  right.left.reset();
  right.right = ValueUnit(0, UnitType::Point);
  tiles = ngn::backgroundTiles({0, 0, 100, 50}, {0, 0, 100, 50}, half, right, once);
  REQUIRE(tiles.size() == 1);
  CHECK(tiles[0].x == doctest::Approx(50));
}

TEST_CASE("background images draw last-listed first, in tiles, clipped to the border box") {
  auto image = [](int stops) {
    auto list = dynamic::array();
    for (int i = 0; i < stops; i++) {
      list.push_back(dynamic::object("color", kRed)("position", nullptr));
    }
    return dynamic::object("type", "linear-gradient")("direction", dynamic::object("type", "angle")("value", 180))("colorStops", list);
  };
  Box b(
      dynamic::object("borderTopLeftRadius", 10)("experimental_backgroundImage", dynamic::array(image(2), image(3)))(
          "experimental_backgroundSize", dynamic::array(dynamic::object("x", "50%")("y", "auto"))),
      100,
      40);
  auto calls = b.drawn();
  CHECK(hasCall(calls, "clip M10,0L100,0L100,40L0,40L0,10C10,0Z"));
  auto drawn = fills(calls);
  REQUIRE(drawn.size() == 4);
  // The second image, with three stops, under the first.
  CHECK(drawn[0] == "fill M0,0L50,0L50,40L0,40L0,0Z linear(0,0 0,40 stops3 t1,1,0,0)");
  CHECK(drawn[1] == "fill M50,0L100,0L100,40L50,40L50,0Z linear(0,0 0,40 stops3 t1,1,50,0)");
  CHECK(drawn[2].find("stops2") != std::string::npos);
}

TEST_CASE("box shadows are layers, the last listed at the bottom, shaped by offset, spread and radius") {
  auto shadows = dynamic::array(
      dynamic::object("offsetX", 0)("offsetY", 18)("blurRadius", 30)("spreadDistance", -12)("color", kRed),
      dynamic::object("offsetX", 0)("offsetY", 2)("blurRadius", 6)("color", kBlue));
  Box b(dynamic::object("borderRadius", 24)("boxShadow", shadows), 200, 100);
  auto box = b.box();
  REQUIRE(box.shadows.size() == 2);
  const auto &bottom = box.shadows[0];
  const auto &top = box.shadows[1];
  CHECK(bottom.argb == 0xff0000ffu);
  CHECK(bottom.radius == 3);
  CHECK(top.argb == 0xffff0000u);
  CHECK(top.radius == 15);
  CHECK_FALSE(top.inset);
  // The spread shrinks the box by 12 on each side and the radius with it; the offset moves it.
  CHECK(Recorder::path(top.shadowPath).rfind("M24,30L176,30C188,42", 0) == 0);
  // The shadow shows only outside the box, out to well past its blur.
  CHECK(top.maskEvenOdd);
  CHECK(Recorder::path(top.mask).rfind("M24,0L176,0C200,24", 0) == 0);
  CHECK(Recorder::path(top.mask).find("M-38,-32") != std::string::npos);
  // A shadow never puts the box on the layer's own drawing.
  CHECK(box.layerDrawn);
}

TEST_CASE("an inset shadow is cast by the padding box's edge round a hole moved by its offset") {
  auto shadows = dynamic::array(dynamic::object("offsetX", 4)("offsetY", 0)("blurRadius", 10)("spreadDistance", 2)("color", kRed)("inset", true));
  Box b(dynamic::object("boxShadow", shadows)("borderWidth", 1)("borderColor", kBlue)("overflow", "hidden"), 100, 50);
  auto box = b.box();
  REQUIRE(box.shadows.size() == 1);
  const auto &s = box.shadows[0];
  CHECK(s.inset);
  CHECK(s.radius == 5);
  CHECK_FALSE(s.maskEvenOdd);
  CHECK(Recorder::path(s.mask) == "M1,1L99,1L99,49L1,49L1,1Z");
  // The padding box grown by the blur, then the hole: the padding box moved 4 right, shrunk by 2,
  // running the other way.
  CHECK(Recorder::path(s.shadowPath) == "M-9,-9L109,-9L109,59L-9,59L-9,-9ZM7,3L7,47L101,47L101,3L7,3Z");
}

TEST_CASE("a percentage radius follows the view's size") {
  Box b(dynamic::object("borderTopLeftRadius", "50%")("backgroundColor", kRed), 100, 50);
  CHECK(fills(b.drawn())[0].rfind("fill M50,0", 0) == 0);
  b.layout.frame.size = {200, 50};
  auto calls = fills(b.drawn());
  REQUIRE(calls.size() == 1);
  // 50% of the new width.
  CHECK(calls[0].rfind("fill M100,0", 0) == 0);
}
