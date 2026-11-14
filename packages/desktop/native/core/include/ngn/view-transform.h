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

} // namespace ngn
