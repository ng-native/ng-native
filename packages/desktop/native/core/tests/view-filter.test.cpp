#include "ngn/desktop-view-props.h"
#include "ngn/view-filter.h"

#include <doctest/doctest.h>

#include <array>

using namespace facebook::react;
using folly::dynamic;
using ngn::FilterStep;

namespace {

std::vector<FilterStep> stepsOf(dynamic filter) {
  auto context = std::make_shared<const ContextContainer>();
  ngn::DesktopViewComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  auto props = descriptor.cloneProps(parserContext, nullptr, RawProps(dynamic::object("filter", std::move(filter))));
  return ngn::filterSteps(static_cast<const ViewProps &>(*props).filter);
}

// A colour step on an unpremultiplied colour, each channel in 0 to 1.
std::array<double, 4> applied(const FilterStep &step, std::array<double, 4> c) {
  REQUIRE(step.type == FilterStep::Type::ColorMatrix);
  std::array<double, 4> out{};
  for (int row = 0; row < 4; ++row) {
    const double *m = &step.matrix[row * 5];
    out[row] = m[0] * c[0] + m[1] * c[1] + m[2] * c[2] + m[3] * c[3] + m[4];
  }
  return out;
}

std::array<double, 4> one(dynamic function, std::array<double, 4> color) {
  auto steps = stepsOf(dynamic::array(std::move(function)));
  REQUIRE(steps.size() == 1);
  return applied(steps[0], color);
}

} // namespace

TEST_CASE("grayscale, sepia and saturate mix the channels as the Filter Effects matrices do") {
  auto gray = one(dynamic::object("grayscale", 1), {1, 0, 0, 1});
  CHECK(gray[0] == doctest::Approx(0.2126));
  CHECK(gray[1] == doctest::Approx(0.2126));
  CHECK(gray[2] == doctest::Approx(0.2126));
  CHECK(gray[3] == doctest::Approx(1));
  // Half way keeps half the colour; past 1 is 1.
  CHECK(one(dynamic::object("grayscale", 0.5), {1, 0, 0, 1})[0] == doctest::Approx(0.2126 + 0.7874 * 0.5));
  CHECK(one(dynamic::object("grayscale", 3), {1, 0, 0, 1})[0] == doctest::Approx(0.2126));

  auto sepia = one(dynamic::object("sepia", 1), {0.5, 0.5, 0.5, 1});
  CHECK(sepia[0] == doctest::Approx((0.393 + 0.769 + 0.189) * 0.5));
  CHECK(sepia[1] == doctest::Approx((0.349 + 0.686 + 0.168) * 0.5));
  CHECK(sepia[2] == doctest::Approx((0.272 + 0.534 + 0.131) * 0.5));

  CHECK(one(dynamic::object("saturate", 0), {1, 0, 0, 1})[0] == doctest::Approx(0.213));
  // Above 1 over-saturates.
  CHECK(one(dynamic::object("saturate", 2), {1, 0, 0, 1})[0] == doctest::Approx(0.213 + 0.787 * 2));
}

TEST_CASE("hue-rotate turns the hue by its angle in degrees") {
  auto turned = one(dynamic::object("hueRotate", 180), {1, 0, 0, 1});
  CHECK(turned[0] == doctest::Approx(0.213 - 0.787).epsilon(0.001));
  CHECK(turned[1] == doctest::Approx(0.213 + 0.213).epsilon(0.001));
  CHECK(turned[2] == doctest::Approx(0.213 + 0.213).epsilon(0.001));
}

TEST_CASE("invert, brightness, contrast and opacity scale each channel and move it") {
  auto inverted = one(dynamic::object("invert", 1), {1, 0, 0.25, 1});
  CHECK(inverted[0] == doctest::Approx(0));
  CHECK(inverted[1] == doctest::Approx(1));
  CHECK(inverted[2] == doctest::Approx(0.75));
  CHECK(inverted[3] == doctest::Approx(1));
  CHECK(one(dynamic::object("invert", 0.5), {1, 0, 0, 1})[0] == doctest::Approx(0.5));

  auto dimmed = one(dynamic::object("brightness", 0.5), {1, 1, 1, 1});
  CHECK(dimmed[0] == doctest::Approx(0.5));
  CHECK(dimmed[3] == doctest::Approx(1));

  CHECK(one(dynamic::object("contrast", 2), {0.75, 0.25, 0.5, 1})[0] == doctest::Approx(1));
  CHECK(one(dynamic::object("contrast", 2), {0.75, 0.25, 0.5, 1})[1] == doctest::Approx(0));
  CHECK(one(dynamic::object("contrast", 2), {0.75, 0.25, 0.5, 1})[2] == doctest::Approx(0.5));

  auto faded = one(dynamic::object("opacity", 0.25), {1, 0, 0, 1});
  CHECK(faded[0] == doctest::Approx(1));
  CHECK(faded[3] == doctest::Approx(0.25));
  // Past 1 is 1, which changes nothing.
  CHECK(stepsOf(dynamic::array(dynamic::object("opacity", 2))).empty());
}

TEST_CASE("blur and drop-shadow are steps of their own, with the standard deviation CSS gives") {
  auto steps = stepsOf(dynamic::array(
      dynamic::object("blur", 4),
      dynamic::object("dropShadow", dynamic::object("offsetX", 3)("offsetY", -2)("standardDeviation", 5)("color", 0x80ff0000))));
  REQUIRE(steps.size() == 2);
  CHECK(steps[0].type == FilterStep::Type::Blur);
  CHECK(steps[0].standardDeviation == 4);
  CHECK(steps[1].type == FilterStep::Type::DropShadow);
  CHECK(steps[1].offsetX == 3);
  CHECK(steps[1].offsetY == -2);
  CHECK(steps[1].standardDeviation == 5);
  CHECK(steps[1].argb == 0x80ff0000u);

  // A drop shadow with no colour is black.
  auto black = stepsOf(dynamic::array(dynamic::object("dropShadow", dynamic::object("offsetX", 1)("offsetY", 1))));
  REQUIRE(black.size() == 1);
  CHECK(black[0].argb == 0xff000000u);
}

TEST_CASE("the steps keep the list's order, and leave out a function that changes nothing") {
  auto steps = stepsOf(dynamic::array(
      dynamic::object("brightness", 1), dynamic::object("blur", 0), dynamic::object("invert", 1), dynamic::object("hueRotate", 0),
      dynamic::object("blur", 2), dynamic::object("opacity", 1), dynamic::object("grayscale", 0)));
  REQUIRE(steps.size() == 2);
  CHECK(steps[0].type == FilterStep::Type::ColorMatrix);
  CHECK(steps[1].type == FilterStep::Type::Blur);
  CHECK(stepsOf(dynamic::array()).empty());
}
