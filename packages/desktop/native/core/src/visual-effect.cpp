#include "ngn/visual-effect.h"

#include "ngn/desktop-view-props.h"

#include <react/renderer/core/propsConversions.h>

#include <string_view>
#include <utility>

using namespace facebook::react;

namespace ngn {

const char VisualEffectComponentName[] = "NgNativeVisualEffect";

VisualEffectProps::VisualEffectProps(
    const PropsParserContext &context,
    const VisualEffectProps &sourceProps,
    const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      HasDesktopProps{parseDesktopProps(context, sourceProps.desktop, rawProps)},
      material(convertRawProp(context, rawProps, "material", sourceProps.material, {})),
      blendingMode(convertRawProp(context, rawProps, "blendingMode", sourceProps.blendingMode, {})),
      state(convertRawProp(context, rawProps, "state", sourceProps.state, {})),
      emphasized(convertRawProp(context, rawProps, "emphasized", sourceProps.emphasized, false)) {}

namespace {

using Material = VisualEffect::Material;

constexpr std::pair<std::string_view, Material> kMaterials[] = {
    {"sidebar", Material::Sidebar},
    {"window-background", Material::WindowBackground},
    {"under-window-background", Material::UnderWindowBackground},
    {"content-background", Material::ContentBackground},
    {"under-page-background", Material::UnderPageBackground},
    {"header-view", Material::HeaderView},
    {"titlebar", Material::Titlebar},
    {"menu", Material::Menu},
    {"popover", Material::Popover},
    {"sheet", Material::Sheet},
    {"hud-window", Material::HudWindow},
    {"full-screen-ui", Material::FullScreenUi},
    {"tooltip", Material::Tooltip},
    {"selection", Material::Selection},
};

} // namespace

VisualEffect visualEffectOf(const VisualEffectProps &props) {
  VisualEffect effect{.emphasized = props.emphasized};
  for (const auto &[name, material] : kMaterials) {
    if (props.material == name) {
      effect.material = material;
    }
  }
  if (props.blendingMode == "within-window") {
    effect.blending = VisualEffect::Blending::WithinWindow;
  }
  if (props.state == "active") {
    effect.state = VisualEffect::State::Active;
  } else if (props.state == "inactive") {
    effect.state = VisualEffect::State::Inactive;
  }
  return effect;
}

} // namespace ngn
