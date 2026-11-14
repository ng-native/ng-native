#include "ngn/view-transform.h"

using namespace facebook::react;

namespace ngn {

std::optional<Transform> layerTransform(const ViewProps &props, const LayoutMetrics &layout) {
  if (props.transform.operations.empty() && props.transform == Transform::Identity()) {
    return std::nullopt;
  }
  auto matrix = props.resolveTransform(layout);
  if (matrix == Transform::Identity()) {
    return std::nullopt;
  }
  // React Native's product applies its right-hand side first, as resolveTransform's own origin
  // shift does: a point moves to the centre's frame, transforms, and moves back.
  const auto &size = layout.frame.size;
  Float cx = size.width / 2;
  Float cy = size.height / 2;
  return Transform::Translate(cx, cy, 0) * matrix * Transform::Translate(-cx, -cy, 0);
}

} // namespace ngn
