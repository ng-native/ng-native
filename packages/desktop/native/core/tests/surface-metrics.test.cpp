#include "ngn/surface-metrics.h"

#include <doctest/doctest.h>

using facebook::react::LayoutDirection;

TEST_CASE("a surface is laid out at its size, from the direction the app runs in") {
  ngn::SurfaceMetrics metrics{.size = {1040, 720}};
  auto constraints = ngn::surfaceConstraints(metrics, false);
  CHECK(constraints.minimumSize == facebook::react::Size{1040, 720});
  CHECK(constraints.maximumSize == facebook::react::Size{1040, 720});
  CHECK(constraints.layoutDirection == LayoutDirection::LeftToRight);
  CHECK(ngn::surfaceConstraints(metrics, true).layoutDirection == LayoutDirection::RightToLeft);
}

TEST_CASE("a runtime's surfaces keep the direction its JavaScript instance started with") {
  bool forced = false;
  ngn::SurfaceDirection direction{[&] { return forced; }};
  // Before any instance: left to right.
  CHECK_FALSE(direction.rightToLeft());
  direction.instanceStarted();
  CHECK_FALSE(direction.rightToLeft());
  // forceRTL(true) during the run: I18nManager's constants keep what they read, and so do the
  // surfaces, a resize or a new window included.
  forced = true;
  CHECK_FALSE(direction.rightToLeft());
  // A reload starts an instance that reads it, and the surfaces follow.
  direction.instanceStarted();
  CHECK(direction.rightToLeft());
  forced = false;
  CHECK(direction.rightToLeft());
  direction.instanceStarted();
  CHECK_FALSE(direction.rightToLeft());
}

TEST_CASE("a runtime with no direction to ask lays out left to right") {
  ngn::SurfaceDirection direction{nullptr};
  direction.instanceStarted();
  CHECK_FALSE(direction.rightToLeft());
}
