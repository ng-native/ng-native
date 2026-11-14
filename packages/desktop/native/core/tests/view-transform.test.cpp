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
