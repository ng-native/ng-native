// What a surface is laid out at: its size, scale, text size and direction. Header-only, and
// toolkit-free.
#pragma once

#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/graphics/Size.h>

namespace ngn {

struct SurfaceMetrics {
  facebook::react::Size size{};
  // Device pixels per point.
  float pointScale{2};
  // The text size multiplier.
  float fontScale{1};
};

// The surface's root constraints: its size, and the direction its layout starts from, which React
// Native's iOS surfaces take from I18nManager.
inline facebook::react::LayoutConstraints surfaceConstraints(const SurfaceMetrics &metrics, bool rightToLeft) {
  using facebook::react::LayoutDirection;
  return {
      .minimumSize = metrics.size,
      .maximumSize = metrics.size,
      .layoutDirection = rightToLeft ? LayoutDirection::RightToLeft : LayoutDirection::LeftToRight,
  };
}

} // namespace ngn
