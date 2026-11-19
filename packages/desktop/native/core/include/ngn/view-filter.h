// A view's CSS `filter` as the steps a toolkit applies to what the view draws, its children
// included: colour matrices from the Filter Effects spec's equivalents, a Gaussian blur, and a drop
// shadow. The GTK host maps each step to a GSK node, and the macOS host to a Core Image filter on
// the view's layer, which draws every step but the drop shadow.
#pragma once

#include <react/renderer/graphics/Filter.h>

#include <array>
#include <cstdint>
#include <vector>

namespace ngn {

struct FilterStep {
  enum class Type { ColorMatrix, Blur, DropShadow };
  Type type{Type::ColorMatrix};
  // ColorMatrix: a 4x5 matrix by rows (r, g, b, a) over unpremultiplied sRGB, its last column an
  // offset in 0 to 1, as SVG's feColorMatrix. The result is clamped to 0 to 1 after each step.
  std::array<double, 20> matrix{1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0};
  // Blur and DropShadow: the Gaussian's standard deviation, in points.
  double standardDeviation{0};
  // DropShadow: its offset and colour, drawn under the view from its alpha.
  double offsetX{0}, offsetY{0};
  uint32_t argb{0xff000000};
  bool operator==(const FilterStep &) const = default;
};

// The steps in the list's order, the first applied first. A function that changes nothing
// (brightness(1), blur(0), ...) is left out.
std::vector<FilterStep> filterSteps(const std::vector<facebook::react::FilterFunction> &filter);

} // namespace ngn
