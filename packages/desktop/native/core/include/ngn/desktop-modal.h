// ModalHostView with the one prop the desktop adds: `anchor`, the tag of the view a modal is
// anchored to, which presents it as a popover at that view (an NSPopover on macOS) instead of a
// cover or a sheet. React Native's own ModalHostViewProps are final and drop any key they do not
// declare, so the core registers ModalHostView with props of its own; the shadow node, its state
// (the size the host sets) and its event emitter are React Native's.
//
// The anchor reaches the backend through DesktopPropsSink, with focusable and tabIndex.
#pragma once

#include "ngn/desktop-view-props.h"

#include <react/renderer/components/FBReactNativeSpec/EventEmitters.h>
#include <react/renderer/components/modal/ModalHostViewState.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>

namespace facebook::react {
extern const char ModalHostViewComponentName[];
} // namespace facebook::react

namespace ngn {

class DesktopModalProps final : public facebook::react::ViewProps {
 public:
  DesktopModalProps() = default;
  DesktopModalProps(
      const facebook::react::PropsParserContext &context,
      const DesktopModalProps &sourceProps,
      const facebook::react::RawProps &rawProps);

  // 0 for none.
  int anchor{0};
};

class DesktopModalShadowNode final : public facebook::react::ConcreteViewShadowNode<
                                         facebook::react::ModalHostViewComponentName,
                                         DesktopModalProps,
                                         facebook::react::ModalHostViewEventEmitter,
                                         facebook::react::ModalHostViewState> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;
  // React Native's ModalHostViewShadowNode's: a root of its own, and never culled.
  static facebook::react::ShadowNodeTraits BaseTraits();
};

// React Native's ModalHostViewComponentDescriptor's adoption: the modal takes the size its state
// says, positioned absolutely.
class DesktopModalComponentDescriptor final
    : public facebook::react::ConcreteComponentDescriptor<DesktopModalShadowNode> {
 public:
  using ConcreteComponentDescriptor::ConcreteComponentDescriptor;
  void adopt(facebook::react::ShadowNode &shadowNode) const override;
};

} // namespace ngn
