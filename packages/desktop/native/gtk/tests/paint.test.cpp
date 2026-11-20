// What a view paints beyond a colour and a solid border, as GSK nodes: gradients and their tiles,
// dashed and dotted borders, CSS filters, and a child's blend with what is under it. Read from the
// pixels GSK's cairo renderer draws, against what Chrome draws for the same CSS.
#include "mounted-views.h"

#include <doctest/doctest.h>

#include <cstdlib>

using namespace facebook::react;
using folly::dynamic;
using ngn::testing::bluish;
using ngn::testing::desktopViewProps;
using ngn::testing::greenish;
using ngn::testing::MountedViews;
using ngn::testing::Pixel;
using ngn::testing::reddish;

namespace {

constexpr int64_t kRed = 0xffff0000;
constexpr int64_t kGreen = 0xff00ff00;
constexpr int64_t kBlue = 0xff0000ff;
constexpr int64_t kWhite = 0xffffffff;

dynamic stops(int64_t from, int64_t to) {
  return dynamic::array(dynamic(dynamic::object("color", from)("position", nullptr)), dynamic(dynamic::object("color", to)("position", nullptr)));
}

// linear-gradient(<angle>deg, from, to)
dynamic linear(double angle, int64_t from, int64_t to) {
  return dynamic::object("type", "linear-gradient")("direction", dynamic::object("type", "angle")("value", angle))("colorStops", stops(from, to));
}

bool clear(const Pixel &p) {
  if (p.a >= 40) {
    MESSAGE("expected nothing, got " << p);
  }
  return p.a < 40;
}

bool gray(const Pixel &p) {
  bool ok = p.a > 200 && std::abs(p.r - p.g) < 12 && std::abs(p.g - p.b) < 12;
  if (!ok) {
    MESSAGE("expected a gray, got " << p);
  }
  return ok;
}

} // namespace

TEST_CASE("a linear gradient runs along its angle across the view") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("experimental_backgroundImage", dynamic::array(linear(90, kRed, kBlue)))), {{20, 20}, {100, 40}}));
  CHECK(reddish(views.pixel(22, 40)));
  CHECK(bluish(views.pixel(117, 40)));
  auto middle = views.pixel(70, 40);
  CHECK(middle.r > 90);
  CHECK(middle.b > 90);
  CHECK(clear(views.pixel(10, 40)));
}

TEST_CASE("a radial gradient spreads from its centre, and pads its last colour past its end") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  dynamic radial = dynamic::object("type", "radial-gradient")("shape", "circle")("size", "closest-side")("colorStops", stops(kRed, kBlue));
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("experimental_backgroundImage", dynamic::array(radial))), {{20, 20}, {100, 100}}));
  CHECK(reddish(views.pixel(70, 70)));
  CHECK(bluish(views.pixel(22, 22)));
  CHECK(bluish(views.pixel(70, 21)));
}

TEST_CASE("a gradient repeats in tiles of its background-size, cut to the view's rounded shape") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  dynamic props = dynamic::object("experimental_backgroundImage", dynamic::array(linear(90, kRed, kBlue)))(
      "experimental_backgroundSize", dynamic::array(dynamic::object("x", 20)("y", 20)))("borderRadius", 20)("backgroundColor", kGreen);
  views.add(MountedViews::shadow(2, "View", desktopViewProps(props), {{20, 20}, {100, 60}}));
  // Each 20 wide tile from red at its left to blue at its right, again in the next.
  CHECK(reddish(views.pixel(42, 50)));
  CHECK(bluish(views.pixel(57, 50)));
  CHECK(reddish(views.pixel(62, 50)));
  CHECK(bluish(views.pixel(117, 50)));
  // And down the view.
  CHECK(reddish(views.pixel(62, 75)));
  // The corner outside the radius is not painted.
  CHECK(clear(views.pixel(21, 21)));
}

TEST_CASE("background-repeat space leaves the background colour between whole tiles") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  dynamic props = dynamic::object("experimental_backgroundImage", dynamic::array(linear(90, kRed, kRed)))(
      "experimental_backgroundSize", dynamic::array(dynamic::object("x", 30)("y", 40)))(
      "experimental_backgroundRepeat", dynamic::array(dynamic::object("x", "space")("y", "no-repeat")))("backgroundColor", kGreen);
  views.add(MountedViews::shadow(2, "View", desktopViewProps(props), {{0, 0}, {100, 40}}));
  // Three tiles of 30 over 100: the first at 0, the last ending at 100, 5 between each.
  CHECK(reddish(views.pixel(15, 20)));
  CHECK(greenish(views.pixel(32, 20)));
  CHECK(reddish(views.pixel(50, 20)));
  CHECK(greenish(views.pixel(67, 20)));
  CHECK(reddish(views.pixel(85, 20)));
}

TEST_CASE("a dashed border draws dashes three times its width along the middle of the border") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  dynamic props = dynamic::object("borderWidth", 4)("borderColor", kRed)("borderStyle", "dashed");
  auto view = MountedViews::shadow(2, "View", desktopViewProps(props), {{20, 20}, {100, 40}});
  views.add(view);
  // From the top left along the top: on from 2 to 14, off to 26, on again to 38.
  CHECK(reddish(views.pixel(28, 22)));
  CHECK(clear(views.pixel(40, 22)));
  CHECK(reddish(views.pixel(52, 22)));
  CHECK(clear(views.pixel(70, 40)));

  // Dotted: dots as long as the width.
  views.update(view, desktopViewProps(dynamic::object("borderWidth", 4)("borderColor", kRed)("borderStyle", "dotted")));
  CHECK(reddish(views.pixel(24, 22)));
  CHECK(clear(views.pixel(28, 22)));
  CHECK(reddish(views.pixel(32, 22)));

  // Solid again: the whole side.
  views.update(view, desktopViewProps(dynamic::object("borderWidth", 4)("borderColor", kRed)));
  CHECK(reddish(views.pixel(28, 22)));
  CHECK(reddish(views.pixel(40, 22)));
}

TEST_CASE("filter grayscale draws the view and its children in grays") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto filter = dynamic::array(dynamic::object("grayscale", 1));
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)("filter", filter)), {{20, 20}, {100, 100}}));
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("backgroundColor", kBlue)), {{50, 50}, {20, 20}}), 2);
  auto red = views.pixel(40, 40);
  CHECK(gray(red));
  // 0.2126 of red's 255.
  CHECK(red.r == doctest::Approx(54).epsilon(0.15));
  CHECK(gray(views.pixel(80, 80)));
}

TEST_CASE("filter functions apply in the order listed") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto darkThenInvert = dynamic::array(dynamic::object("brightness", 0), dynamic::object("invert", 1));
  auto view = MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)("filter", darkThenInvert)), {{20, 20}, {60, 60}});
  views.add(view);
  auto white = views.pixel(50, 50);
  CHECK(white.r > 230);
  CHECK(white.g > 230);
  CHECK(white.b > 230);

  auto invertThenDark = dynamic::array(dynamic::object("invert", 1), dynamic::object("brightness", 0));
  views.update(view, desktopViewProps(dynamic::object("backgroundColor", kRed)("filter", invertThenDark)));
  auto black = views.pixel(50, 50);
  CHECK(black.a > 230);
  CHECK(black.r + black.g + black.b < 30);

  // No filter: red again.
  views.update(view, desktopViewProps(dynamic::object("backgroundColor", kRed)));
  CHECK(reddish(views.pixel(50, 50)));
}

TEST_CASE("filter blur softens the view's edge, and drop-shadow draws its shape under it, moved") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)("filter", dynamic::array(dynamic::object("blur", 4)))), {{40, 40}, {40, 40}}));
  CHECK(reddish(views.pixel(60, 60)));
  auto outside = views.pixel(37, 60);
  CHECK(outside.a > 10);
  CHECK(outside.a < 200);
  CHECK(clear(views.pixel(25, 60)));

  dynamic shadow = dynamic::object("dropShadow", dynamic::object("offsetX", 20)("offsetY", 20)("standardDeviation", 0)("color", kBlue));
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)("filter", dynamic::array(shadow))), {{120, 120}, {40, 40}}));
  CHECK(reddish(views.pixel(140, 140)));
  CHECK(bluish(views.pixel(170, 170)));
  CHECK(clear(views.pixel(125, 170)));
}

TEST_CASE("a child's mix-blend-mode blends it with its parent's box and the siblings drawn before it") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)("overflow", "hidden")), {{20, 20}, {100, 100}}));
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("backgroundColor", kBlue)), {{50, 0}, {50, 100}}), 2);
  auto screen = MountedViews::shadow(4, "View", desktopViewProps(dynamic::object("backgroundColor", kGreen)("mixBlendMode", "screen")), {{0, 0}, {150, 50}});
  views.add(screen, 2);
  // Green screened over red is yellow, over blue cyan.
  auto yellow = views.pixel(40, 40);
  CHECK(yellow.r > 220);
  CHECK(yellow.g > 220);
  CHECK(yellow.b < 40);
  auto cyan = views.pixel(100, 40);
  CHECK(cyan.r < 40);
  CHECK(cyan.g > 220);
  CHECK(cyan.b > 220);
  // Below the child, the parent and its first child as they are; past the parent's edge, nothing.
  CHECK(reddish(views.pixel(40, 100)));
  CHECK(clear(views.pixel(150, 40)));

  // Back to normal, the child draws over the parent; blending again, it blends.
  views.update(screen, desktopViewProps(dynamic::object("backgroundColor", kGreen)));
  CHECK(greenish(views.pixel(40, 40)));
  views.update(screen, desktopViewProps(dynamic::object("backgroundColor", kGreen)("mixBlendMode", "multiply")));
  auto multiplied = views.pixel(40, 40);
  CHECK(multiplied.a > 220);
  CHECK(multiplied.r + multiplied.g + multiplied.b < 40);
}

TEST_CASE("a blending child after another keeps both blends, and a later sibling draws over them") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("backgroundColor", kWhite)), {{0, 0}, {120, 60}}));
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)("mixBlendMode", "multiply")), {{0, 0}, {60, 60}}), 2);
  views.add(MountedViews::shadow(4, "View", desktopViewProps(dynamic::object("backgroundColor", kBlue)("mixBlendMode", "multiply")), {{30, 0}, {60, 60}}), 2);
  views.add(MountedViews::shadow(5, "View", desktopViewProps(dynamic::object("backgroundColor", kGreen)), {{100, 0}, {20, 60}}), 2);
  CHECK(reddish(views.pixel(15, 30)));
  // Red times blue is black.
  auto both = views.pixel(45, 30);
  CHECK(both.r + both.g + both.b < 40);
  CHECK(bluish(views.pixel(75, 30)));
  CHECK(greenish(views.pixel(110, 30)));
}

TEST_CASE("a dashed border with no colour set is black, as a solid one is") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto view = MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("borderWidth", 4)("borderStyle", "dashed")), {{20, 20}, {100, 40}});
  views.add(view);
  auto dash = views.pixel(28, 22);
  CHECK(dash.a > 230);
  CHECK(dash.r + dash.g + dash.b < 30);
  views.update(view, desktopViewProps(dynamic::object("borderWidth", 4)("borderStyle", "dotted")));
  auto dot = views.pixel(24, 22);
  CHECK(dot.a > 230);
  CHECK(dot.r + dot.g + dot.b < 30);
}

TEST_CASE("each filter colour step keeps its own clamp: brightness 2 then 0.5 of 0.75 is 0.5") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto filter = dynamic::array(dynamic::object("brightness", 2), dynamic::object("brightness", 0.5));
  // 0.75 doubled clamps to 1, which halved is 0.5; one merged step would leave 0.75.
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("backgroundColor", 0xffbfbfbf)("filter", filter)), {{20, 20}, {60, 60}}));
  auto pixel = views.pixel(50, 50);
  CHECK(pixel.r == doctest::Approx(128).epsilon(0.05));
  CHECK(pixel.g == doctest::Approx(128).epsilon(0.05));
}
