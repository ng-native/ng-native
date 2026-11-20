#include "ngn/view-transform.h"

#include <cmath>

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

std::optional<Point> layerPointAt(const Transform &transform, Point point) {
  const auto &m = transform.matrix;
  double a = m[0], b = m[4], c = m[12];
  double d = m[1], e = m[5], f = m[13];
  double g = m[3], h = m[7], i = m[15];
  double det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (std::abs(det) < 1e-9) {
    return std::nullopt;
  }
  double x = point.x;
  double y = point.y;
  double ix = ((e * i - f * h) * x + (c * h - b * i) * y + (b * f - c * e)) / det;
  double iy = ((f * g - d * i) * x + (a * i - c * g) * y + (c * d - a * f)) / det;
  double iw = ((d * h - e * g) * x + (b * g - a * h) * y + (a * e - b * d)) / det;
  if (std::abs(iw) < 1e-12) {
    return std::nullopt;
  }
  return Point{static_cast<Float>(ix / iw), static_cast<Float>(iy / iw)};
}

std::optional<PlaneSteps> planeSteps(const Transform &transform) {
  const auto &m = transform.matrix;
  constexpr double kNone = 1e-9;
  if (std::abs(m[3]) > kNone || std::abs(m[7]) > kNone || std::abs(m[15]) < kNone) {
    return std::nullopt;
  }
  // x' = a x + c y + tx, y' = b x + d y + ty, as layerPointAt reads the matrix.
  double a = m[0] / m[15], b = m[1] / m[15], c = m[4] / m[15], d = m[5] / m[15];
  // [a c; b d] = rotate(angle) * [1 shear; 0 1] * scale(sx, sy).
  double sx = std::hypot(a, b);
  double det = a * d - b * c;
  if (sx < kNone || std::abs(det) < kNone) {
    return std::nullopt;
  }
  double cosine = a / sx, sine = b / sx;
  double sy = det / sx;
  double shear = (cosine * c + sine * d) / sy;
  constexpr double kDegrees = 180.0 / 3.14159265358979323846;
  return PlaneSteps{
      .scaleX = static_cast<Float>(sx),
      .scaleY = static_cast<Float>(sy),
      .skewX = static_cast<Float>(std::atan(shear) * kDegrees),
      .rotate = static_cast<Float>(std::atan2(sine, cosine) * kDegrees),
      .translateX = static_cast<Float>(m[12] / m[15]),
      .translateY = static_cast<Float>(m[13] / m[15]),
  };
}

} // namespace ngn
