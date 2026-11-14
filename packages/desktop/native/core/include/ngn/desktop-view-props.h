// The desktop view props interface: the View props React Native's cross-platform ViewProps drop
// and the desktop needs. `focusable` and `tabIndex`, which Tab order reads; `desktopCursor`, the
// CSS cursors React Native's `cursor` (auto and pointer) lacks; `scrollbarWidth` and
// `scrollbarGutter` on a scroll view; and the opt-ins for the desktop's element events,
// `onDoubleClick`, `onContextMenu` and `onWheel` (input-dispatcher.h).
//
// The core registers View and ScrollView with descriptors whose props carry them, and reports them
// to the backend as plain values through DesktopPropsSink when a view is created and whenever they
// change.
#pragma once

#include "ngn/desktop-props.h"

#include <react/renderer/components/scrollview/ScrollViewProps.h>
#include <react/renderer/components/scrollview/ScrollViewShadowNode.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/components/view/ViewShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

#include <optional>

namespace ngn {

// The desktop props an update sets, on top of `source`'s.
DesktopProps parseDesktopProps(
    const facebook::react::PropsParserContext &context,
    const DesktopProps &source,
    const facebook::react::RawProps &rawProps);

class DesktopViewProps final : public facebook::react::ViewProps, public HasDesktopProps {
 public:
  DesktopViewProps() = default;
  DesktopViewProps(
      const facebook::react::PropsParserContext &context,
      const DesktopViewProps &sourceProps,
      const facebook::react::RawProps &rawProps);
  // A View's props with the desktop props unset.
  explicit DesktopViewProps(const facebook::react::ViewProps &viewProps) : facebook::react::ViewProps(viewProps) {}
};

class DesktopScrollViewProps final : public facebook::react::ScrollViewProps, public HasDesktopProps {
 public:
  DesktopScrollViewProps() = default;
  DesktopScrollViewProps(
      const facebook::react::PropsParserContext &context,
      const DesktopScrollViewProps &sourceProps,
      const facebook::react::RawProps &rawProps);
  explicit DesktopScrollViewProps(const facebook::react::ScrollViewProps &props)
      : facebook::react::ScrollViewProps(props) {}
};

// The desktop props of any props object: a View's own, or the defaults for anything else.
DesktopProps desktopProps(const facebook::react::Props &props);

// React Native's component with `DesktopPropsT`, which derives from the props its shadow node
// reads. Everything else (traits, flattening, state, measuring) is the shadow node's own.
template <class ShadowNodeT, class DesktopPropsT>
class DesktopPropsComponentDescriptor final : public facebook::react::ConcreteComponentDescriptor<ShadowNodeT> {
  using Base = facebook::react::ConcreteComponentDescriptor<ShadowNodeT>;
  using BaseProps = typename ShadowNodeT::ConcreteProps;

 public:
  explicit DesktopPropsComponentDescriptor(const facebook::react::ComponentDescriptorParameters &parameters)
      : Base(parameters, preparedParser()) {}

  // ConcreteComponentDescriptor::cloneProps's classic path, constructing DesktopPropsT.
  facebook::react::Props::Shared cloneProps(
      const facebook::react::PropsParserContext &context,
      const facebook::react::Props::Shared &props,
      facebook::react::RawProps rawProps) const override {
    if (!props && rawProps.isEmpty()) {
      return ShadowNodeT::defaultSharedProps();
    }
    rawProps.parse(this->rawPropsParser_);
    static const DesktopPropsT defaults;
    const auto *source = props ? dynamic_cast<const DesktopPropsT *>(props.get()) : &defaults;
    if (source == nullptr) {
      // Props made before this descriptor (Fabric's shared defaults): start from them.
      DesktopPropsT upgraded{static_cast<const BaseProps &>(*props)};
      return std::make_shared<const DesktopPropsT>(context, upgraded, rawProps);
    }
    return std::make_shared<const DesktopPropsT>(context, *source, rawProps);
  }

 private:
  // The parser records the keys a props class reads the first time it is prepared, so it has to
  // be prepared for DesktopPropsT before ConcreteComponentDescriptor prepares it for the base
  // props, whose keys are a subset and add nothing once the parser is ready.
  static facebook::react::RawPropsParser preparedParser() {
    facebook::react::RawPropsParser parser;
    parser.template prepare<DesktopPropsT>();
    return parser;
  }
};

using DesktopViewComponentDescriptor =
    DesktopPropsComponentDescriptor<facebook::react::ViewShadowNode, DesktopViewProps>;
using DesktopScrollViewComponentDescriptor =
    DesktopPropsComponentDescriptor<facebook::react::ScrollViewShadowNode, DesktopScrollViewProps>;

// Implemented by a backend that maps desktop props onto its toolkit (key-view loop, Tab order).
class DesktopPropsSink {
 public:
  virtual ~DesktopPropsSink() = default;
  virtual void updateDesktopProps(SurfaceId surfaceId, Tag tag, const DesktopProps &props) = 0;
};

} // namespace ngn
