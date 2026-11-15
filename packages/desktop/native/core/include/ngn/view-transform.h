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

} // namespace ngn
