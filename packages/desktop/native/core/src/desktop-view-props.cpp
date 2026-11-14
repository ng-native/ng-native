#include "ngn/desktop-view-props.h"

#include <react/renderer/core/propsConversions.h>

using namespace facebook::react;

namespace ngn {

DesktopViewProps::DesktopViewProps(
    const PropsParserContext &context,
    const DesktopViewProps &sourceProps,
    const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      desktop{
          .focusable = convertRawProp(context, rawProps, "focusable", sourceProps.desktop.focusable, {}),
          .tabIndex = convertRawProp(context, rawProps, "tabIndex", sourceProps.desktop.tabIndex, {}),
      } {}

DesktopProps desktopProps(const Props &props) {
  if (const auto *desktopView = dynamic_cast<const DesktopViewProps *>(&props)) {
    return desktopView->desktop;
  }
  return {};
}

namespace {

// The parser records the keys a props class reads the first time it is prepared, so it has to be
// prepared for DesktopViewProps before ConcreteComponentDescriptor prepares it for ViewProps,
// whose keys are a subset and add nothing once the parser is ready.
RawPropsParser desktopViewPropsParser() {
  RawPropsParser parser;
  parser.prepare<DesktopViewProps>();
  return parser;
}

} // namespace

DesktopViewComponentDescriptor::DesktopViewComponentDescriptor(const ComponentDescriptorParameters &parameters)
    : ConcreteComponentDescriptor(parameters, desktopViewPropsParser()) {}

// ConcreteComponentDescriptor::cloneProps's classic path, constructing DesktopViewProps, which
// ViewShadowNode reads as the ViewProps it derives from.
Props::Shared DesktopViewComponentDescriptor::cloneProps(
    const PropsParserContext &context,
    const Props::Shared &props,
    RawProps rawProps) const {
  if (!props && rawProps.isEmpty()) {
    return ViewShadowNode::defaultSharedProps();
  }
  rawProps.parse(rawPropsParser_);
  static const DesktopViewProps defaults;
  const auto *source = props ? dynamic_cast<const DesktopViewProps *>(props.get()) : &defaults;
  if (source == nullptr) {
    // A View's props made before this descriptor (Fabric's shared defaults): start from them.
    DesktopViewProps upgraded{static_cast<const ViewProps &>(*props)};
    return std::make_shared<const DesktopViewProps>(context, upgraded, rawProps);
  }
  return std::make_shared<const DesktopViewProps>(context, *source, rawProps);
}

} // namespace ngn
