#include "NgNativeButtonShadowNode.h"

#import <react/renderer/core/LayoutConstraints.h>
#import <react/renderer/core/propsConversions.h>

#import "NgNativeButtonMetrics.h"

namespace facebook::react {

extern const char NgNativeButtonComponentName[] = "NgNativeButton";

NgNativeButtonProps::NgNativeButtonProps(
    const PropsParserContext &context,
    const NgNativeButtonProps &sourceProps,
    const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      title(convertRawProp(context, rawProps, "title", sourceProps.title, {})),
      kind(convertRawProp(context, rawProps, "kind", sourceProps.kind, {})),
      controlSize(convertRawProp(context, rawProps, "controlSize", sourceProps.controlSize, {})),
      sfSymbol(convertRawProp(context, rawProps, "sfSymbol", sourceProps.sfSymbol, {})),
      iconImage(convertRawProp(context, rawProps, "iconImage", sourceProps.iconImage, {})),
      enabled(convertRawProp(context, rawProps, "enabled", sourceProps.enabled, true))
{
}

static NSString *string(const std::string &value)
{
  return [[NSString alloc] initWithBytes:value.data() length:value.size() encoding:NSUTF8StringEncoding] ?: @"";
}

Size NgNativeButtonShadowNode::measureContent(
    const LayoutContext & /*layoutContext*/,
    const LayoutConstraints &layoutConstraints) const
{
  const auto &props = getConcreteProps();
  NSString *controlSize = string(props.controlSize);
  // Room is kept for an image only when the button can decode it, as NgNativeButtonComponentView does.
  BOOL hasImage = !props.iconImage.empty() && NgNativeButtonImage(string(props.iconImage), controlSize) != nil;
  CGSize size = NgNativeButtonNaturalSize(string(props.title), controlSize, string(props.sfSymbol), hasImage);
  // A narrower box truncates the title rather than wrapping it.
  return layoutConstraints.clamp({.width = (Float)size.width, .height = (Float)size.height});
}

} // namespace facebook::react
