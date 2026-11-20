#include "ngn/view-filter.h"

#include "ngn/svg.h"

#include <react/renderer/graphics/Color.h>

#include <algorithm>
#include <cmath>
#include <optional>
#include <variant>

using namespace facebook::react;

namespace ngn {

namespace {

using Matrix = std::array<double, 20>;

constexpr Matrix kIdentity{1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0};

// Each colour channel times `slope` plus `intercept`: feComponentTransfer's linear function.
Matrix linear(double slope, double intercept) {
  return {slope, 0, 0, 0, intercept, 0, slope, 0, 0, intercept, 0, 0, slope, 0, intercept, 0, 0, 0, 1, 0};
}

// The Filter Effects spec's grayscale and sepia matrices, at `amount` from 0 to 1.
Matrix grayscale(double amount) {
  double s = 1 - amount;
  return {0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s, 0, 0,
          0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s, 0, 0,
          0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s, 0, 0,
          0, 0, 0, 1, 0};
}

Matrix sepia(double amount) {
  double s = 1 - amount;
  return {0.393 + 0.607 * s, 0.769 - 0.769 * s, 0.189 - 0.189 * s, 0, 0,
          0.349 - 0.349 * s, 0.686 + 0.314 * s, 0.168 - 0.168 * s, 0, 0,
          0.272 - 0.272 * s, 0.534 - 0.534 * s, 0.131 + 0.869 * s, 0, 0,
          0, 0, 0, 1, 0};
}

std::optional<Matrix> colorMatrix(FilterType type, double value) {
  double unit = std::clamp(value, 0.0, 1.0);
  switch (type) {
    case FilterType::Brightness:
      return linear(value, 0);
    case FilterType::Contrast:
      return linear(value, 0.5 - 0.5 * value);
    case FilterType::Grayscale:
      return grayscale(unit);
    case FilterType::Sepia:
      return sepia(unit);
    case FilterType::Invert:
      return linear(1 - 2 * unit, unit);
    case FilterType::Saturate:
      return svgColorMatrix(1, {value});
    case FilterType::HueRotate:
      return svgColorMatrix(2, {value});
    case FilterType::Opacity: {
      Matrix m = kIdentity;
      m[18] = unit;
      return m;
    }
    default:
      return std::nullopt;
  }
}

} // namespace

std::vector<FilterStep> filterSteps(const std::vector<FilterFunction> &filter) {
  std::vector<FilterStep> steps;
  for (const auto &function : filter) {
    if (function.type == FilterType::DropShadow) {
      const auto *shadow = std::get_if<DropShadowParams>(&function.parameters);
      if (!shadow) {
        continue;
      }
      FilterStep step{.type = FilterStep::Type::DropShadow};
      step.offsetX = shadow->offsetX;
      step.offsetY = shadow->offsetY;
      step.standardDeviation = std::max<double>(0, shadow->standardDeviation);
      if (shadow->color) {
        auto c = colorComponentsFromColor(shadow->color);
        auto byte = [](float v) { return static_cast<uint32_t>(std::clamp(v, 0.0f, 1.0f) * 255 + 0.5f); };
        step.argb = byte(c.alpha) << 24 | byte(c.red) << 16 | byte(c.green) << 8 | byte(c.blue);
      }
      steps.push_back(step);
      continue;
    }
    const auto *value = std::get_if<Float>(&function.parameters);
    if (!value) {
      continue;
    }
    if (function.type == FilterType::Blur) {
      if (*value > 0) {
        steps.push_back({.type = FilterStep::Type::Blur, .standardDeviation = *value});
      }
      continue;
    }
    auto matrix = colorMatrix(function.type, *value);
    bool identity = matrix && std::equal(matrix->begin(), matrix->end(), kIdentity.begin(), [](double a, double b) {
      return std::abs(a - b) < 1e-9;
    });
    if (matrix && !identity) {
      steps.push_back({.type = FilterStep::Type::ColorMatrix, .matrix = *matrix});
    }
  }
  return steps;
}

} // namespace ngn
