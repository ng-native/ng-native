#include "ngn/glass.h"

#include "ngn/desktop-view-props.h"

#include <react/renderer/components/view/conversions.h>
#include <react/renderer/core/propsConversions.h>

using namespace facebook::react;

namespace ngn {

const char GlassViewComponentName[] = "ViewManagerAdapter_ExpoGlassEffect_GlassView";
const char GlassContainerComponentName[] = "ViewManagerAdapter_ExpoGlassEffect_GlassContainer";

GlassProps::GlassProps(const PropsParserContext &context, const GlassProps &sourceProps, const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      HasDesktopProps{parseDesktopProps(context, sourceProps.desktop, rawProps)},
      glassEffectStyle(
          convertRawProp(context, rawProps, "glassEffectStyle", sourceProps.glassEffectStyle, folly::dynamic(nullptr))),
      tintColor(convertRawProp(context, rawProps, "tintColor", sourceProps.tintColor, {})),
      isInteractive(convertRawProp(context, rawProps, "isInteractive", sourceProps.isInteractive, false)),
      colorScheme(convertRawProp(context, rawProps, "colorScheme", sourceProps.colorScheme, {})),
      spacing(convertRawProp(context, rawProps, "spacing", sourceProps.spacing, 0.0)) {}

std::optional<Glass> glassOf(const GlassProps &props) {
  const auto &value = props.glassEffectStyle;
  std::string style = "regular";
  if (value.isString()) {
    style = value.asString();
  } else if (value.isObject()) {
    if (const auto *named = value.get_ptr("style"); named != nullptr && named->isString()) {
      style = named->asString();
    }
  }
  if (style == "none") {
    return std::nullopt;
  }
  Glass glass{
      .style = style == "clear" ? Glass::Style::Clear : Glass::Style::Regular,
      .tint = props.tintColor,
      .interactive = props.isInteractive,
  };
  if (props.colorScheme == "light" || props.colorScheme == "dark") {
    glass.dark = props.colorScheme == "dark";
  }
  return glass;
}

} // namespace ngn
