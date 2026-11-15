#include "fake-backend.h"
#include "ngn/glass.h"
#include "ngn/mounting-manager.h"

#include <doctest/doctest.h>

using namespace facebook::react;

namespace {

struct Parser {
  std::shared_ptr<const ContextContainer> context = std::make_shared<const ContextContainer>();
  ngn::GlassViewComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  std::shared_ptr<const ngn::GlassProps> props(folly::dynamic raw, Props::Shared source = nullptr) {
    return std::static_pointer_cast<const ngn::GlassProps>(descriptor.cloneProps(parserContext, source, RawProps(std::move(raw))));
  }
};

} // namespace

TEST_CASE("expo-glass and its container are components of the host, by expo-glass-effect's names") {
  CHECK(std::string(ngn::GlassViewComponentName) == "ViewManagerAdapter_ExpoGlassEffect_GlassView");
  CHECK(std::string(ngn::GlassContainerComponentName) == "ViewManagerAdapter_ExpoGlassEffect_GlassContainer");
  auto backend = std::make_shared<ngn::testing::FakeBackend>();
  auto mounting = std::make_shared<ngn::MountingManager>(backend, backend);
  CHECK(mounting->hasComponent(ngn::GlassViewComponentName));
  CHECK(mounting->hasComponent(ngn::GlassContainerComponentName));
}

TEST_CASE("the glass follows glassEffectStyle, as a name or an object, its tint, interactivity and scheme") {
  Parser p;
  auto plain = p.props(folly::dynamic::object());
  REQUIRE(ngn::glassOf(*plain));
  CHECK(*ngn::glassOf(*plain) == ngn::Glass{});

  auto clear = p.props(folly::dynamic::object("glassEffectStyle", "clear")("isInteractive", true)("colorScheme", "dark")(
      "tintColor", 0x330a84ff));
  auto glass = ngn::glassOf(*clear);
  REQUIRE(glass);
  CHECK(glass->style == ngn::Glass::Style::Clear);
  CHECK(glass->interactive);
  CHECK(glass->dark == true);
  CHECK(glass->tint == clear->tintColor);
  CHECK(glass->tint);

  auto animated = p.props(folly::dynamic::object("glassEffectStyle", folly::dynamic::object("style", "clear")("animate", true)));
  CHECK(ngn::glassOf(*animated)->style == ngn::Glass::Style::Clear);
  CHECK_FALSE(ngn::glassOf(*animated)->dark.has_value());

  CHECK_FALSE(ngn::glassOf(*p.props(folly::dynamic::object("glassEffectStyle", "none"))));
  CHECK_FALSE(ngn::glassOf(*p.props(folly::dynamic::object("glassEffectStyle", folly::dynamic::object("style", "none")))));
  // An update back to the default style draws regular glass again.
  auto none = p.props(folly::dynamic::object("glassEffectStyle", "none"));
  auto back = p.props(folly::dynamic::object("glassEffectStyle", nullptr), none);
  REQUIRE(ngn::glassOf(*back));
  CHECK(ngn::glassOf(*back)->style == ngn::Glass::Style::Regular);
  // The container's spacing.
  CHECK(p.props(folly::dynamic::object("spacing", 10))->spacing == 10);
}
