// `<native-button>` on iOS: the C++ side of the `NgNativeButton` Fabric component, which React
// Native's codegen would write for a React component. The props are the element's (title, kind,
// controlSize, sfSymbol, enabled), the event is `topButtonPress`, and the shadow node measures the
// button for Yoga from the same metrics the view draws it with (NgNativeButtonMetrics).
#pragma once

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>

#include <string>

namespace facebook::react {

extern const char NgNativeButtonComponentName[];

class NgNativeButtonProps final : public ViewProps {
 public:
  NgNativeButtonProps() = default;
  NgNativeButtonProps(
      const PropsParserContext &context,
      const NgNativeButtonProps &sourceProps,
      const RawProps &rawProps);

  std::string title{};
  // `default`, `cancel`, `destructive`, `plain`, or empty for a plain push button.
  std::string kind{};
  // `mini`, `small`, `regular` or `large`; empty is `regular`.
  std::string controlSize{};
  std::string sfSymbol{};
  bool enabled{true};
};

class NgNativeButtonEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  void onButtonPress() const
  {
    dispatchEvent("buttonPress");
  }
};

class NgNativeButtonShadowNode final
    : public ConcreteViewShadowNode<NgNativeButtonComponentName, NgNativeButtonProps, NgNativeButtonEventEmitter> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  static ShadowNodeTraits BaseTraits()
  {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    return traits;
  }

  Size measureContent(const LayoutContext &layoutContext, const LayoutConstraints &layoutConstraints)
      const override;
};

using NgNativeButtonComponentDescriptor = ConcreteComponentDescriptor<NgNativeButtonShadowNode>;

} // namespace facebook::react
