#include "ngn/desktop-view-props.h"
#include "ngn/view-transform.h"

#include <doctest/doctest.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/utils/ContextContainer.h>

using namespace facebook::react;

namespace {

// Through the desktop's own view descriptor, as a commit parses them.
ViewProps parse(folly::dynamic raw) {
  auto context = std::make_shared<const ContextContainer>();
  ngn::DesktopViewComponentDescriptor descriptor({{}, context, nullptr});
  PropsParserContext parser{1, *context};
  return *std::static_pointer_cast<const ViewProps>(descriptor.cloneProps(parser, nullptr, RawProps(std::move(raw))));
}

LayoutMetrics sized(Float width, Float height) {
  LayoutMetrics layout;
  layout.frame.size = {width, height};
  return layout;
}

// Where the layer puts its own point (x, y).
Point apply(const Transform &t, Point p) {
  return {p.x * t.matrix[0] + p.y * t.matrix[4] + t.matrix[12], p.x * t.matrix[1] + p.y * t.matrix[5] + t.matrix[13]};
}

} // namespace

TEST_CASE("a view with no transform leaves its layer alone") {
  auto props = parse(folly::dynamic::object());
  CHECK_FALSE(ngn::layerTransform(props, sized(100, 50)));
  auto identity = parse(folly::dynamic::object("transform", folly::dynamic::array(folly::dynamic::object("translateX", 0))));
  CHECK_FALSE(ngn::layerTransform(identity, sized(100, 50)));
}

TEST_CASE("a translation moves the layer as it is, wherever its anchor is") {
  // The inbox row's swipe.
  auto props = parse(folly::dynamic::object("transform", folly::dynamic::array(folly::dynamic::object("translateX", -160))));
  auto t = ngn::layerTransform(props, sized(400, 80));
  REQUIRE(t);
  auto moved = apply(*t, {0, 0});
  CHECK(moved.x == doctest::Approx(-160));
  CHECK(moved.y == doctest::Approx(0));
}

TEST_CASE("a scale and a rotation turn about the view's centre on a layer anchored at its corner") {
  auto scaled = parse(folly::dynamic::object("transform", folly::dynamic::array(folly::dynamic::object("scale", 2))));
  auto t = ngn::layerTransform(scaled, sized(100, 50));
  REQUIRE(t);
  // The centre stays; the corner moves out from it.
  CHECK(apply(*t, {50, 25}).x == doctest::Approx(50));
  CHECK(apply(*t, {50, 25}).y == doctest::Approx(25));
  CHECK(apply(*t, {0, 0}).x == doctest::Approx(-50));
  CHECK(apply(*t, {0, 0}).y == doctest::Approx(-25));

  auto turned = parse(folly::dynamic::object("transform", folly::dynamic::array(folly::dynamic::object("rotate", "90deg"))));
  auto r = ngn::layerTransform(turned, sized(100, 100));
  REQUIRE(r);
  CHECK(apply(*r, {50, 50}).x == doctest::Approx(50));
  // A quarter turn clockwise (y down) takes the top-left corner to the top-right.
  CHECK(apply(*r, {0, 0}).x == doctest::Approx(100));
  CHECK(apply(*r, {0, 0}).y == doctest::Approx(0).epsilon(0.001));
}

TEST_CASE("a transform origin at the corner turns about the corner") {
  auto props = parse(folly::dynamic::object("transform", folly::dynamic::array(folly::dynamic::object("scale", 2)))(
      "transformOrigin", folly::dynamic::array(0, 0, 0)));
  auto t = ngn::layerTransform(props, sized(100, 50));
  REQUIRE(t);
  CHECK(apply(*t, {0, 0}).x == doctest::Approx(0));
  CHECK(apply(*t, {10, 10}).x == doctest::Approx(20));
}

namespace {

// Where the steps put a point: scaled, skewed along x, rotated, then moved.
Point applySteps(const ngn::PlaneSteps &s, Point p) {
  constexpr double kRadians = 3.14159265358979323846 / 180.0;
  double x = p.x * s.scaleX, y = p.y * s.scaleY;
  x += std::tan(s.skewX * kRadians) * y;
  double cosine = std::cos(s.rotate * kRadians), sine = std::sin(s.rotate * kRadians);
  return {static_cast<Float>(cosine * x - sine * y + s.translateX), static_cast<Float>(sine * x + cosine * y + s.translateY)};
}

folly::dynamic transformOf(folly::dynamic operations) {
  return folly::dynamic::object("transform", std::move(operations));
}

} // namespace

TEST_CASE("a transform with no perspective draws the plane as 2D steps that put every point where it does") {
  using folly::dynamic;
  for (const auto &operations : {
           dynamic::array(dynamic::object("translateX", 120)),
           dynamic::array(dynamic::object("rotate", "30deg"), dynamic::object("scale", 1.5)),
           dynamic::array(dynamic::object("skewX", "20deg"), dynamic::object("translateY", -8)),
           dynamic::array(dynamic::object("scaleX", -1)),
           dynamic::array(dynamic::object("rotate", "200deg"), dynamic::object("scaleY", 0.35), dynamic::object("skewY", "10deg")),
           // Turned about x with no perspective: flattened onto the screen, still 2D.
           dynamic::array(dynamic::object("rotateX", "40deg")),
       }) {
    CAPTURE(operations[0].items().begin()->first.asString());
    auto layer = ngn::layerTransform(parse(transformOf(operations)), sized(72, 48));
    REQUIRE(layer);
    auto steps = ngn::planeSteps(*layer);
    REQUIRE(steps);
    for (Point p : {Point{0, 0}, Point{72, 0}, Point{0, 48}, Point{31, 17}}) {
      Point want = apply(*layer, p);
      Point got = applySteps(*steps, p);
      CHECK(got.x == doctest::Approx(want.x).epsilon(1e-4));
      CHECK(got.y == doctest::Approx(want.y).epsilon(1e-4));
    }
  }
}

TEST_CASE("perspective, or a plane flattened to a line, has no 2D steps") {
  using folly::dynamic;
  auto perspective = ngn::layerTransform(
      parse(transformOf(dynamic::array(dynamic::object("perspective", 400), dynamic::object("rotateY", "30deg")))), sized(72, 48));
  REQUIRE(perspective);
  CHECK_FALSE(ngn::planeSteps(*perspective));
  auto flat = ngn::layerTransform(parse(transformOf(dynamic::array(dynamic::object("scaleY", 0)))), sized(72, 48));
  REQUIRE(flat);
  CHECK_FALSE(ngn::planeSteps(*flat));
}
