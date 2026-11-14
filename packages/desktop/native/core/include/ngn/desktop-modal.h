// ModalHostView with the props the desktop reads: `presentationStyle` and `transparent`, which
// choose a sheet or an in-window cover, and the one prop the desktop adds, `anchor`, the tag of the
// view a modal is anchored to, which presents it as a popover at that view (an NSPopover on macOS).
// React Native's own ModalHostViewProps are final and drop any key they do not declare, so the core
// registers ModalHostView with props of its own; the shadow node, its state (the size the host
// sets) and its event emitter are React Native's.
//
// `pageSheet`, `formSheet` or no style is a sheet on the window; `fullScreen`, `overFullScreen` or
// `transparent` is a cover in the window, below its title bar. The presentation and the anchor
// reach the backend through DesktopPropsSink, with focusable and tabIndex.
//
// A sheet takes the size of its content's root: the root's definite CSS width and height where it
// has them, and otherwise a default width and the height its content lays out to, which takes a
// second commit. Either way it stays between 320x200 and the window.
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
  std::string presentationStyle;
  bool transparent{false};
};

ModalPresentation modalPresentation(const DesktopModalProps &props);

constexpr facebook::react::Size kMinimumSheetSize{320, 200};
// A sheet's width when its root has no definite one.
constexpr facebook::react::Float kDefaultSheetWidth = 480;

// A view of a sheet's content as Yoga laid it out, read from the shadow tree rather than the
// mounted views, which Fabric flattens: a layout-only root with a CSS size is not mounted at all.
struct SheetNode {
  facebook::react::Rect frame;
  // The definite CSS width and height, in points, where the view has them.
  std::optional<facebook::react::Float> width;
  std::optional<facebook::react::Float> height;
  std::vector<SheetNode> children;
};

// A laid out shadow node and those under it, leaving out a modal inside, which is presented on
// its own.
SheetNode sheetNode(const facebook::react::ShadowNode &node);

// The size a sheet takes for `modal`, laid out at the size it has now, on a window whose content
// is `window`.
facebook::react::Size sheetSize(const SheetNode &modal, facebook::react::Size window);

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
