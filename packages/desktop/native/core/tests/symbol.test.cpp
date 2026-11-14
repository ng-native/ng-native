#include "ngn/symbol.h"

#include <doctest/doctest.h>

#include <react/utils/ContextContainer.h>

using namespace facebook::react;
using Mode = ngn::SymbolPaint::Mode;

namespace {

struct Symbols {
  std::shared_ptr<ContextContainer> context = std::make_shared<ContextContainer>();
  ngn::SymbolComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};

  std::shared_ptr<const ngn::SymbolProps> props(folly::dynamic raw, Props::Shared source = nullptr) {
    return std::static_pointer_cast<const ngn::SymbolProps>(descriptor.cloneProps(parserContext, source, RawProps(std::move(raw))));
  }
};

// ARGB as the engine's processColor commits it.
constexpr int64_t kRed = 0xffff0000, kGreen = 0xff00ff00;

} // namespace

TEST_CASE("<expo-symbol> commits as expo-symbols' view, whose props are read") {
  CHECK(std::string(ngn::SymbolComponentName) == "ViewManagerAdapter_SymbolModule");
  Symbols s;
  auto p = s.props(folly::dynamic::object("name", "heart.fill")("type", "palette")("weight", "semibold")("scale", "large")(
      "tintColor", kRed)("colors", folly::dynamic::array(kRed, kGreen))("resizeMode", "center")("opacity", 0.5));
  CHECK(p->name == "heart.fill");
  CHECK(p->type == "palette");
  CHECK(p->weight == "semibold");
  CHECK(p->scale == "large");
  CHECK(p->tintColor == colorFromRGBA(255, 0, 0, 255));
  REQUIRE(p->colors.size() == 2);
  CHECK(p->colors[1] == colorFromRGBA(0, 255, 0, 255));
  CHECK(p->resizeMode == "center");
  CHECK(p->opacity == doctest::Approx(0.5));
  // An update keeps what it does not set.
  auto next = s.props(folly::dynamic::object("name", "star"), p);
  CHECK(next->weight == "semibold");
  CHECK(s.props(folly::dynamic::object("type", nullptr), next)->type == "monochrome");
}

TEST_CASE("symbolPaint colours each type as expo-symbols configures it") {
  Symbols s;
  auto red = colorFromRGBA(255, 0, 0, 255);
  auto plain = ngn::symbolPaint(*s.props(folly::dynamic::object("name", "a")));
  CHECK(plain.mode == Mode::Monochrome);
  CHECK(plain.colors.empty());
  auto tinted = ngn::symbolPaint(*s.props(folly::dynamic::object("name", "a")("tintColor", kRed)));
  CHECK(tinted.colors == std::vector<SharedColor>{red});
  auto layered = ngn::symbolPaint(*s.props(folly::dynamic::object("type", "hierarchical")));
  CHECK(layered.mode == Mode::Hierarchical);
  CHECK(layered.colors.empty());
  auto palette = ngn::symbolPaint(*s.props(folly::dynamic::object("type", "palette")("colors", folly::dynamic::array(kRed, kGreen))));
  CHECK(palette.mode == Mode::Palette);
  CHECK(palette.colors.size() == 2);
  // A palette of one is no palette: the symbol is drawn in its tint.
  auto one = ngn::symbolPaint(*s.props(folly::dynamic::object("type", "palette")("colors", folly::dynamic::array(kGreen))("tintColor", kRed)));
  CHECK(one.mode == Mode::Monochrome);
  CHECK(one.colors == std::vector<SharedColor>{red});
  auto many = ngn::symbolPaint(*s.props(folly::dynamic::object("type", "multicolor")("tintColor", kRed)));
  CHECK(many.mode == Mode::Multicolor);
  CHECK(many.colors == std::vector<SharedColor>{red});
}

TEST_CASE("placeSymbol places an image as UIKit's content modes do") {
  std::pair<double, double> image{20, 10}, box{100, 100};
  CHECK(ngn::placeSymbol("", image, box) == ngn::SymbolRect{0, 25, 100, 50});
  CHECK(ngn::placeSymbol("scaleAspectFit", image, box) == ngn::SymbolRect{0, 25, 100, 50});
  CHECK(ngn::placeSymbol("unknown", image, box) == ngn::SymbolRect{0, 25, 100, 50});
  CHECK(ngn::placeSymbol("scaleToFill", image, box) == ngn::SymbolRect{0, 0, 100, 100});
  CHECK(ngn::placeSymbol("redraw", image, box) == ngn::SymbolRect{0, 0, 100, 100});
  CHECK(ngn::placeSymbol("scaleAspectFill", image, box) == ngn::SymbolRect{-50, 0, 200, 100});
  CHECK(ngn::placeSymbol("center", image, box) == ngn::SymbolRect{40, 45, 20, 10});
  CHECK(ngn::placeSymbol("top", image, box) == ngn::SymbolRect{40, 0, 20, 10});
  CHECK(ngn::placeSymbol("bottom", image, box) == ngn::SymbolRect{40, 90, 20, 10});
  CHECK(ngn::placeSymbol("left", image, box) == ngn::SymbolRect{0, 45, 20, 10});
  CHECK(ngn::placeSymbol("right", image, box) == ngn::SymbolRect{80, 45, 20, 10});
  CHECK(ngn::placeSymbol("topLeft", image, box) == ngn::SymbolRect{0, 0, 20, 10});
  CHECK(ngn::placeSymbol("topRight", image, box) == ngn::SymbolRect{80, 0, 20, 10});
  CHECK(ngn::placeSymbol("bottomLeft", image, box) == ngn::SymbolRect{0, 90, 20, 10});
  CHECK(ngn::placeSymbol("bottomRight", image, box) == ngn::SymbolRect{80, 90, 20, 10});
  // An image with no size draws nothing.
  CHECK(ngn::placeSymbol("", {0, 0}, box) == ngn::SymbolRect{});
}

TEST_CASE("NgNativeSymbol answers a symbol's image size, and null for a name with none") {
  struct Measurer final : ngn::SymbolMeasurer {
    std::vector<std::string> asked;
    std::optional<std::pair<double, double>> imageSize(const std::string &name, double pointSize, const std::string &weight, const std::string &scale) override {
      asked.push_back(name + " " + std::to_string(static_cast<int>(pointSize)) + " " + weight + " " + scale);
      if (name == "nothing") {
        return std::nullopt;
      }
      return std::pair{pointSize * 1.2, pointSize};
    }
  };
  auto measurer = std::make_shared<Measurer>();
  auto module = ngn::makeSymbolModule(measurer);
  CHECK(module->call("imageSize", folly::dynamic::array("heart", 20, "bold", "large")) == folly::dynamic::array(24.0, 20.0));
  CHECK(module->call("imageSize", folly::dynamic::array("heart", 10, nullptr, nullptr)) == folly::dynamic::array(12.0, 10.0));
  CHECK(module->call("imageSize", folly::dynamic::array("nothing", 10)) == folly::dynamic(nullptr));
  CHECK(module->call("imageSize", folly::dynamic::array(5, 10)) == folly::dynamic(nullptr));
  CHECK(measurer->asked == std::vector<std::string>{"heart 20 bold large", "heart 10  ", "nothing 10  "});
}
