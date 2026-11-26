#include "fake-backend.h"
#include "ngn/mounting-manager.h"
#include "ngn/visual-effect.h"

#include <doctest/doctest.h>

using namespace facebook::react;

namespace {

struct Parser {
  std::shared_ptr<const ContextContainer> context = std::make_shared<const ContextContainer>();
  ngn::VisualEffectComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  std::shared_ptr<const ngn::VisualEffectProps> props(folly::dynamic raw, Props::Shared source = nullptr) {
    return std::static_pointer_cast<const ngn::VisualEffectProps>(
        descriptor.cloneProps(parserContext, source, RawProps(std::move(raw))));
  }
};

} // namespace

TEST_CASE("visual-effect is a component of the host, as NgNativeVisualEffect") {
  CHECK(std::string(ngn::VisualEffectComponentName) == "NgNativeVisualEffect");
  auto backend = std::make_shared<ngn::testing::FakeBackend>();
  auto mounting = std::make_shared<ngn::MountingManager>(backend, backend);
  CHECK(mounting->hasComponent(ngn::VisualEffectComponentName));
}

TEST_CASE("a visual effect defaults to the sidebar's material, behind the window, following its state") {
  Parser p;
  auto effect = ngn::visualEffectOf(*p.props(folly::dynamic::object()));
  CHECK(effect == ngn::VisualEffect{});
  CHECK(effect.material == ngn::VisualEffect::Material::Sidebar);
  CHECK(effect.blending == ngn::VisualEffect::Blending::BehindWindow);
  CHECK(effect.state == ngn::VisualEffect::State::FollowsWindow);
  CHECK_FALSE(effect.emphasized);
  // A name it does not know draws the default rather than nothing.
  CHECK(ngn::visualEffectOf(*p.props(folly::dynamic::object("material", "frosted"))).material ==
        ngn::VisualEffect::Material::Sidebar);
}

TEST_CASE("a visual effect follows its material, blending mode, state and emphasis, and goes back to the defaults") {
  Parser p;
  auto hud = p.props(
      folly::dynamic::object("material", "hud-window")("blendingMode", "within-window")("state", "active")(
          "emphasized", true));
  auto effect = ngn::visualEffectOf(*hud);
  CHECK(effect.material == ngn::VisualEffect::Material::HudWindow);
  CHECK(effect.blending == ngn::VisualEffect::Blending::WithinWindow);
  CHECK(effect.state == ngn::VisualEffect::State::Active);
  CHECK(effect.emphasized);

  CHECK(ngn::visualEffectOf(*p.props(folly::dynamic::object("material", "under-window-background"))).material ==
        ngn::VisualEffect::Material::UnderWindowBackground);
  CHECK(ngn::visualEffectOf(*p.props(folly::dynamic::object("state", "inactive"))).state ==
        ngn::VisualEffect::State::Inactive);

  // Props taken away (sent as null) fall back to the defaults, not to what they were.
  auto cleared = p.props(
      folly::dynamic::object("material", nullptr)("blendingMode", nullptr)("state", nullptr)("emphasized", nullptr), hud);
  CHECK(ngn::visualEffectOf(*cleared) == ngn::VisualEffect{});
}
