// A view's `transform` as a layer whose anchor is its top-left corner takes it. React Native iOS
// sets `props.resolveTransform(layoutMetrics)` on a UIView's layer, whose anchor is its centre;
// an AppKit view's layer is anchored at its origin, so the same matrix is moved there.
#pragma once

#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/LayoutMetrics.h>
#include <react/renderer/graphics/Transform.h>

#include <optional>

namespace ngn {

// Nothing for no transform: the layer keeps the identity.
std::optional<facebook::react::Transform> layerTransform(
    const facebook::react::ViewProps &props,
    const facebook::react::LayoutMetrics &layout);

// The point of the layer's own plane (z = 0) that `transform` draws at `point`, both from the
// layer's corner: the inverse of the homography of the matrix's x, y and w rows and columns.
// Nothing when the transform flattens the plane to a line or a point.
std::optional<facebook::react::Point> layerPointAt(
    const facebook::react::Transform &transform,
    facebook::react::Point point);

// The plane's picture under `transform` as a 2D map in steps a 2D toolkit takes: the point is
// scaled, then skewed along x (degrees), then rotated (degrees, clockwise with y down), then moved.
// A transform with no perspective draws the plane (z = 0) with such a map whatever it does in z,
// which is what a renderer that only draws 2D (GSK's cairo one) needs. Nothing when the transform
// has perspective, or flattens the plane to a line or a point.
struct PlaneSteps {
  facebook::react::Float scaleX{1};
  facebook::react::Float scaleY{1};
  facebook::react::Float skewX{0};
  facebook::react::Float rotate{0};
  facebook::react::Float translateX{0};
  facebook::react::Float translateY{0};
};
std::optional<PlaneSteps> planeSteps(const facebook::react::Transform &transform);

} // namespace ngn
