// What a surface is laid out at: its size, scale, text size and direction. Header-only, and
// toolkit-free.
#pragma once

#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/graphics/Size.h>

#include <atomic>
#include <functional>
#include <utility>

namespace ngn {

struct SurfaceMetrics {
  facebook::react::Size size{};
  // Device pixels per point.
  float pointScale{2};
  // The text size multiplier.
  float fontScale{1};
};

// The text size multiplier a Linux desktop asks for, from GTK's `gtk-xft-dpi`: the text scaling
// factor times 96 dots per inch, in 1024ths of one, so 98304 is 1. Unset (-1, or 0) is 1. macOS's
// is always 1.
inline float xftFontScale(int xftDpi) {
  return xftDpi > 0 ? static_cast<float>(xftDpi) / (96.0f * 1024.0f) : 1.0f;
}

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

// The direction a runtime's surfaces lay out from: what `read` answers as each JavaScript instance
// starts (the first load and each reload), kept for that instance's run as I18nManager's constants
// are, so a surface started or resized meanwhile agrees with what JavaScript reads.
class SurfaceDirection {
 public:
  explicit SurfaceDirection(std::function<bool()> read) : read_(std::move(read)) {}
  void instanceStarted() {
    rightToLeft_ = read_ && read_();
  }
  bool rightToLeft() const {
    return rightToLeft_;
  }

 private:
  std::function<bool()> read_;
  std::atomic<bool> rightToLeft_{false};
};

} // namespace ngn
