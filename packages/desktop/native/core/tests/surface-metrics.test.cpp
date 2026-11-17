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
