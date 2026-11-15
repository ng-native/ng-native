#include "fake-backend.h"

#include <doctest/doctest.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>

using namespace facebook::react;
using ngn::testing::FakeTextMeasurer;

namespace {

AttributedString text(const std::string &string) {
  AttributedString attributed;
  AttributedString::Fragment fragment;
  fragment.string = string;
  attributed.appendFragment(std::move(fragment));
  return attributed;
}

struct Fixture {
  std::shared_ptr<FakeTextMeasurer> measurer = std::make_shared<FakeTextMeasurer>();
  std::shared_ptr<ContextContainer> context = [this] {
    auto c = std::make_shared<ContextContainer>();
    ngn::installTextMeasurer(*c, measurer);
    return c;
  }();
  TextLayoutManager manager{context};

  Size measure(const std::string &string, Size maximum, Float scale = 2) {
    TextLayoutContext layoutContext;
    layoutContext.pointScaleFactor = scale;
    LayoutConstraints constraints{{0, 0}, maximum};
    return manager.measure(AttributedStringBox{text(string)}, {}, layoutContext, constraints).size;
  }
};

} // namespace

TEST_CASE("text is measured by the backend's measurer and rounded up to the device pixel") {
  Fixture f;
  // 5 x 7.3 = 36.5 wide, 17.1 high: 17.1 rounds up to 17.5 at 2x and to 18 at 1x.
  auto size = f.measure("hello", {1000, 1000});
  CHECK(size.width == doctest::Approx(36.5));
  CHECK(size.height == doctest::Approx(17.5));
  CHECK(f.measure("hello", {1000, 1000}, 1).height == doctest::Approx(18));
}

TEST_CASE("the result is clamped to the constraints") {
  Fixture f;
  auto size = f.measure("a longer line of text", {40, 10});
  CHECK(size.width == doctest::Approx(40));
  CHECK(size.height == doctest::Approx(10));
}

TEST_CASE("a measurement is cached for the same text and constraints") {
  Fixture f;
  f.measure("hello", {1000, 1000});
  f.measure("hello", {1000, 1000});
  CHECK(f.measurer->calls == 1);
  f.measure("hello", {500, 1000});
  CHECK(f.measurer->calls == 2);
}

TEST_CASE("an empty string measures one line high and no width, as React Native iOS measures it") {
  // An empty text input with no placeholder: its box is a line of its font, not nothing.
  Fixture f;
  auto size = f.measure("", {1000, 1000});
  CHECK(size.width == doctest::Approx(0));
  CHECK(size.height == doctest::Approx(17.5));
}
