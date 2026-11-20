// A View's `filter` and `mix-blend-mode` reach its layer as filters (view-effects.h), stay there
// through the layouts that follow, and come off when the props drop them.
#include "mounted-views.h"

#include <doctest/doctest.h>

using ngn::testing::MountedViews;
using ngn::testing::viewProps;

TEST_CASE("A view's filter and mix-blend-mode are set on its layer, kept through a layout, and removed") {
  MountedViews mounted;
  folly::dynamic effects = folly::dynamic::object("filter", folly::dynamic::array(folly::dynamic::object("grayscale", 1)))("mixBlendMode", "multiply");
  auto view = MountedViews::shadow(5, "View", viewProps(effects));
  mounted.add(view);
  NSView *native = mounted.view(5);
  REQUIRE((native != nil));
  CHECK(native.layerUsesCoreImageFilters);
  // The sRGB conversions around a colour matrix and its clamp.
  CHECK(native.layer.filters.count == 4);
  CHECK([native.layer.compositingFilter isEqual:@"multiplyBlendMode"]);

  // A layout, which applies the visuals again, leaves the filters as they are.
  auto moved = view;
  moved.layoutMetrics.frame.origin.y = 40;
  mounted.mount({facebook::react::ShadowViewMutation::UpdateMutation(view, moved, MountedViews::kSurface)});
  CHECK(native.layer.filters.count == 4);
  CHECK([native.layer.compositingFilter isEqual:@"multiplyBlendMode"]);

  // Props with neither take both off.
  mounted.update(view, viewProps(folly::dynamic::object()));
  CHECK((native.layer.filters.count == 0));
  CHECK((native.layer.compositingFilter == nil));
  CHECK_FALSE(native.layerUsesCoreImageFilters);
}

TEST_CASE("A view's filter changes with its props, and one blend mode gives way to another") {
  MountedViews mounted;
  auto view = MountedViews::shadow(5, "View", viewProps(folly::dynamic::object("filter", folly::dynamic::array(folly::dynamic::object("blur", 3)))));
  mounted.add(view);
  NSView *native = mounted.view(5);
  CHECK(native.layer.filters.count == 3);

  mounted.update(view, viewProps(folly::dynamic::object("filter", folly::dynamic::array(folly::dynamic::object("blur", 3), folly::dynamic::object("sepia", 1)))("mixBlendMode", "screen")));
  CHECK(native.layer.filters.count == 5);
  CHECK([native.layer.compositingFilter isEqual:@"screenBlendMode"]);

  // A blend taken off keeps the filter's need for Core Image.
  mounted.update(view, viewProps(folly::dynamic::object("filter", folly::dynamic::array(folly::dynamic::object("blur", 3)))));
  CHECK((native.layer.compositingFilter == nil));
  CHECK(native.layerUsesCoreImageFilters);
  CHECK(native.layer.filters.count == 3);
}
