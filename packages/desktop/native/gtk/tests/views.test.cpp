// Views mounted into GTK: Yoga's frames and transforms reach the widgets, and each view paints its
// box as GSK nodes, in Fabric's order, cut to its shape when it clips. Read from the pixels the
// window's renderer draws.
#include "mounted-views.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using folly::dynamic;
using ngn::testing::bluish;
using ngn::testing::desktopViewProps;
using ngn::testing::greenish;
using ngn::testing::MountedViews;
using ngn::testing::reddish;

namespace {

constexpr int64_t kRed = 0xffff0000;
constexpr int64_t kGreen = 0xff00ff00;
constexpr int64_t kBlue = 0xff0000ff;

graphene_rect_t boundsIn(GtkWidget *widget, GtkWidget *ancestor) {
  graphene_rect_t bounds;
  REQUIRE(gtk_widget_compute_bounds(widget, ancestor, &bounds));
  return bounds;
}

} // namespace

TEST_CASE("a view's widget is placed at its Yoga frame, and moves when the frame does") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto box = MountedViews::shadow(2, "View", desktopViewProps(dynamic::object()), {{10, 20}, {100, 50}});
  views.add(box);
  auto bounds = boundsIn(views.view(2), views.surface);
  CHECK(bounds.origin.x == doctest::Approx(10));
  CHECK(bounds.origin.y == doctest::Approx(20));
  CHECK(bounds.size.width == doctest::Approx(100));
  CHECK(bounds.size.height == doctest::Approx(50));

  auto moved = views.mounting->tree().find(2)->view;
  auto next = moved;
  next.layoutMetrics.frame = {{30, 40}, {60, 30}};
  views.mount({ShadowViewMutation::UpdateMutation(moved, next, MountedViews::kSurface)});
  bounds = boundsIn(views.view(2), views.surface);
  CHECK(bounds.origin.x == doctest::Approx(30));
  CHECK(bounds.origin.y == doctest::Approx(40));
  CHECK(bounds.size.width == doctest::Approx(60));
}

TEST_CASE("a transform moves and scales the view about its centre, as React Native's does") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto transform = dynamic::array(dynamic::object("translateX", 15), dynamic::object("scale", 2));
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("transform", transform)), {{40, 40}, {20, 20}}));
  auto bounds = boundsIn(views.view(2), views.surface);
  // Scaled twice about its centre (50, 50) and moved right by 15.
  CHECK(bounds.origin.x == doctest::Approx(45));
  CHECK(bounds.origin.y == doctest::Approx(30));
  CHECK(bounds.size.width == doctest::Approx(40));
}

TEST_CASE("a view paints its background in its rounded shape and its border along its edge") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  dynamic props = dynamic::object("backgroundColor", kRed)("borderWidth", 4)("borderColor", kBlue)("borderRadius", 20);
  views.add(MountedViews::shadow(2, "View", desktopViewProps(props), {{20, 20}, {100, 100}}));
  CHECK(reddish(views.pixel(70, 70)));
  CHECK(bluish(views.pixel(70, 21)));
  CHECK(bluish(views.pixel(21, 70)));
  // The corner outside the radius is not painted.
  CHECK(views.pixel(21, 21).a < 40);
  // Outside the view, nothing.
  CHECK(views.pixel(10, 10).a == 0);
}

TEST_CASE("each side of the border takes its own width and colour") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  dynamic props = dynamic::object("borderLeftWidth", 10)("borderLeftColor", kGreen)("borderTopWidth", 2)("borderTopColor", kBlue);
  views.add(MountedViews::shadow(2, "View", desktopViewProps(props), {{20, 20}, {100, 100}}));
  CHECK(greenish(views.pixel(25, 70)));
  CHECK(bluish(views.pixel(70, 20)));
  CHECK(views.pixel(70, 70).a == 0);
  CHECK(views.pixel(118, 70).a == 0);
}

TEST_CASE("an outer box shadow paints outside the box, an inset one inside it") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto outer = dynamic::array(dynamic::object("offsetX", 10)("offsetY", 0)("blurRadius", 0)("spreadDistance", 0)("color", kBlue));
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("boxShadow", outer)("backgroundColor", kRed)), {{20, 20}, {50, 50}}));
  CHECK(bluish(views.pixel(75, 45)));
  CHECK(reddish(views.pixel(45, 45)));

  auto inset = dynamic::array(dynamic::object("offsetX", 0)("offsetY", 0)("blurRadius", 0)("spreadDistance", 8)("color", kGreen)("inset", true));
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("boxShadow", inset)("backgroundColor", kRed)), {{100, 100}, {60, 60}}));
  CHECK(greenish(views.pixel(103, 130)));
  CHECK(reddish(views.pixel(130, 130)));
}

TEST_CASE("a view that clips its overflow cuts its children to its shape, and one that does not shows them") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto parent = MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("overflow", "hidden")), {{20, 20}, {50, 50}});
  views.add(parent);
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)), {{0, 0}, {120, 120}}), 2);
  CHECK(reddish(views.pixel(40, 40)));
  CHECK(views.pixel(100, 100).a == 0);

  views.update(parent, desktopViewProps(dynamic::object("overflow", "visible")));
  CHECK(reddish(views.pixel(100, 100)));
}

TEST_CASE("views draw in Fabric's order: a later sibling over an earlier one, an insert at 0 under both") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)), {{20, 20}, {60, 60}}));
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("backgroundColor", kBlue)), {{40, 40}, {60, 60}}));
  CHECK(bluish(views.pixel(60, 60)));
  views.add(MountedViews::shadow(4, "View", desktopViewProps(dynamic::object("backgroundColor", kGreen)), {{0, 0}, {120, 120}}), MountedViews::kSurface, 0);
  CHECK(bluish(views.pixel(60, 60)));
  CHECK(reddish(views.pixel(30, 30)));
  CHECK(greenish(views.pixel(110, 110)));
}

TEST_CASE("opacity fades the view and its children") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)("opacity", 0.5)), {{20, 20}, {60, 60}}));
  auto p = views.pixel(50, 50);
  CHECK(p.a > 100);
  CHECK(p.a < 160);
}

TEST_CASE("a covered screen is hidden without being unmounted, and shows again") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)), {{20, 20}, {60, 60}}));
  // Something else stays on screen, so the surface still draws.
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("backgroundColor", kGreen)), {{150, 150}, {20, 20}}));
  views.backend->setCovered(MountedViews::kSurface, 2, true);
  views.settle();
  CHECK(views.pixel(50, 50).a == 0);
  views.backend->setCovered(MountedViews::kSurface, 2, false);
  views.settle();
  CHECK(reddish(views.pixel(50, 50)));
}
