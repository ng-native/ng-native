// The desktop view props interface: the View props React Native's cross-platform ViewProps drop
// and the desktop needs, `focusable` and `tabIndex`, which Tab order reads.
//
// The core registers View with a descriptor whose props carry them, and reports them to the
// backend as plain values through DesktopPropsSink when a view is created and whenever they
// change.
#pragma once

#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/components/view/ViewShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

#include <optional>

namespace ngn {

using facebook::react::SurfaceId;
using facebook::react::Tag;

struct DesktopProps {
  // Unset means the toolkit's default for the component.
  std::optional<bool> focusable;
  // Unset means no explicit place in Tab order. Negative leaves the view out of it.
  std::optional<int> tabIndex;
  // ModalHostView only: the view it is anchored to, as a popover (desktop-modal.h).
  std::optional<Tag> anchor;

  bool operator==(const DesktopProps &other) const = default;
};

class DesktopViewProps final : public facebook::react::ViewProps {
 public:
  DesktopViewProps() = default;
  DesktopViewProps(
      const facebook::react::PropsParserContext &context,
      const DesktopViewProps &sourceProps,
      const facebook::react::RawProps &rawProps);
  // A View's props with the desktop props unset.
  explicit DesktopViewProps(const facebook::react::ViewProps &viewProps) : facebook::react::ViewProps(viewProps) {}

  DesktopProps desktop;
};

// The desktop props of any props object: a View's own, or the defaults for anything else.
DesktopProps desktopProps(const facebook::react::Props &props);

// View, with DesktopViewProps. Everything else (traits, flattening, state) is ViewShadowNode's.
class DesktopViewComponentDescriptor final
    : public facebook::react::ConcreteComponentDescriptor<facebook::react::ViewShadowNode> {
 public:
  explicit DesktopViewComponentDescriptor(const facebook::react::ComponentDescriptorParameters &parameters);

  facebook::react::Props::Shared cloneProps(
      const facebook::react::PropsParserContext &context,
      const facebook::react::Props::Shared &props,
      facebook::react::RawProps rawProps) const override;
};

// Implemented by a backend that maps desktop props onto its toolkit (key-view loop, Tab order).
class DesktopPropsSink {
 public:
  virtual ~DesktopPropsSink() = default;
  virtual void updateDesktopProps(SurfaceId surfaceId, Tag tag, const DesktopProps &props) = 0;
};

} // namespace ngn
