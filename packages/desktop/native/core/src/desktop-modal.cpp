#include "ngn/desktop-modal.h"

#include <react/renderer/core/propsConversions.h>

using namespace facebook::react;

namespace ngn {

DesktopModalProps::DesktopModalProps(
    const PropsParserContext &context,
    const DesktopModalProps &sourceProps,
    const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      anchor(convertRawProp(context, rawProps, "anchor", sourceProps.anchor, 0)) {}

ShadowNodeTraits DesktopModalShadowNode::BaseTraits() {
  auto traits = ConcreteViewShadowNode::BaseTraits();
  traits.set(ShadowNodeTraits::Trait::RootNodeKind);
  traits.set(ShadowNodeTraits::Trait::Unstable_uncullableView);
  return traits;
}

void DesktopModalComponentDescriptor::adopt(ShadowNode &shadowNode) const {
  auto &layoutable = static_cast<YogaLayoutableShadowNode &>(shadowNode);
  const auto &state = static_cast<const DesktopModalShadowNode::ConcreteState &>(*shadowNode.getState()).getData();
  layoutable.setSize(Size{.width = state.screenSize.width, .height = state.screenSize.height});
  layoutable.setPositionType(YGPositionTypeAbsolute);
  ConcreteComponentDescriptor::adopt(shadowNode);
}

} // namespace ngn
