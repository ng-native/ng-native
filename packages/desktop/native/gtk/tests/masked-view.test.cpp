// @react-native-masked-view/masked-view's view on GTK (view-widget.cpp): its children drawn through
// its first child, which is not drawn itself, as `<gradient-text>`'s letters mask its fill.
#include "mounted-views.h"
#include "ngn/masked-view.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using folly::dynamic;
using ngn::testing::desktopViewProps;
using ngn::testing::MountedViews;
using ngn::testing::Pixel;
using ngn::testing::reddish;

namespace {
constexpr int64_t kRed = 0xffff0000;
constexpr int64_t kBlack = 0xff000000;

bool black(const Pixel &p) {
  return p.a > 200 && p.r < 50 && p.g < 50 && p.b < 50;
}
} // namespace

TEST_CASE("a masked view draws its children through its first child, which it does not draw") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, ngn::MaskedViewComponentName, desktopViewProps(dynamic::object()), {{0, 0}, {200, 100}}));
  // The mask: opaque over the top half. The fill: red over the left half, so the mask's own black
  // would show over the right half if it were drawn.
  auto mask = MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("backgroundColor", kBlack)), {{0, 0}, {200, 50}});
  views.add(mask, 2);
  views.add(MountedViews::shadow(4, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)), {{0, 0}, {100, 100}}), 2);
  CHECK(reddish(views.pixel(50, 25)));
  CHECK_FALSE(black(views.pixel(150, 25)));
  CHECK_FALSE(reddish(views.pixel(50, 75)));
}

TEST_CASE("a masked view's content keeps its blend modes") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  constexpr int64_t kBlue = 0xff0000ff;
  views.add(MountedViews::shadow(2, ngn::MaskedViewComponentName, desktopViewProps(dynamic::object()), {{0, 0}, {200, 100}}));
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("backgroundColor", kBlack)), {{0, 0}, {200, 100}}), 2);
  views.add(MountedViews::shadow(4, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)), {{0, 0}, {200, 100}}), 2);
  // Blue multiplied over red is black.
  views.add(MountedViews::shadow(5, "View", desktopViewProps(dynamic::object("backgroundColor", kBlue)("mixBlendMode", "multiply")), {{0, 0}, {100, 100}}), 2);
  CHECK(black(views.pixel(50, 50)));
  CHECK(reddish(views.pixel(150, 50)));
}
