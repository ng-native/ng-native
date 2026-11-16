// `<split-view>` on an iPad: the C++ side of the three Fabric components the host draws it with.
// `NgNativeSplitView` is the UISplitViewController; `NgNativeSidebar` (props `collapsed`,
// `paneMinWidth`, `paneMaxWidth`, the event `topSidebarCollapse`) and `NgNativeSplitContent` are
// its two columns. Each column's frame is the column controller's, which the view puts in the
// node's state: the descriptor gives Yoga its size, so what is inside a column lays out at the
// width UIKit gives it, and the node's layout takes its origin, so a measurement of what is inside
// a column counts where the column is.
#pragma once

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/components/view/YogaLayoutableShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/PropsParserContext.h>

namespace facebook::react {

extern const char NgNativeSplitViewComponentName[];
extern const char NgNativeSidebarComponentName[];
extern const char NgNativeSplitContentComponentName[];

// A column's frame in the split view, as UIKit laid it out: zero until the view has been placed in
// its column.
class NgNativeSplitPaneState final {
 public:
  NgNativeSplitPaneState() = default;
  explicit NgNativeSplitPaneState(Rect frame) : origin(frame.origin), size(frame.size) {}

  Point origin{};
  Size size{};
};

// The split view's and the content column's props, which are a view's. A type of their own, as
// React Native asks of a view subclass.
class NgNativeSplitProps final : public ViewProps {
 public:
  using ViewProps::ViewProps;
};

class NgNativeSidebarProps final : public ViewProps {
 public:
  NgNativeSidebarProps() = default;
  NgNativeSidebarProps(
      const PropsParserContext &context,
      const NgNativeSidebarProps &sourceProps,
      const RawProps &rawProps);

  bool collapsed{false};
  // In points; zero leaves the bound to UIKit.
  Float paneMinWidth{0};
  Float paneMaxWidth{0};
};

class NgNativeSidebarEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  void onSidebarCollapse(bool collapsed) const;
};

using NgNativeSplitViewShadowNode = ConcreteViewShadowNode<NgNativeSplitViewComponentName, NgNativeSplitProps>;

// A column's node, which Yoga sizes and which sits where UIKit put the column. The origin is set on
// the frame, not as Yoga's `left` and `top`, which a right-to-left layout swaps.
template <const char *Name, class PropsT, class EventEmitterT>
class NgNativeSplitPaneShadowNode final
    : public ConcreteViewShadowNode<Name, PropsT, EventEmitterT, NgNativeSplitPaneState> {
 public:
  using ConcreteViewShadowNode<Name, PropsT, EventEmitterT, NgNativeSplitPaneState>::ConcreteViewShadowNode;

  void layout(LayoutContext layoutContext) override
  {
    const auto &column = this->getStateData();
    if (column.size.width > 0 && column.size.height > 0) {
      auto metrics = this->getLayoutMetrics();
      metrics.frame.origin = column.origin;
      this->setLayoutMetrics(metrics);
    }
    ConcreteViewShadowNode<Name, PropsT, EventEmitterT, NgNativeSplitPaneState>::layout(layoutContext);
  }
};

using NgNativeSidebarShadowNode =
    NgNativeSplitPaneShadowNode<NgNativeSidebarComponentName, NgNativeSidebarProps, NgNativeSidebarEventEmitter>;

using NgNativeSplitContentShadowNode =
    NgNativeSplitPaneShadowNode<NgNativeSplitContentComponentName, NgNativeSplitProps, ViewEventEmitter>;

// A column: once UIKit has sized it, that size is the node's, out of the split view's flow. Setting
// the size dirties the node, so a new frame, its origin alone among it, is laid out again.
template <class ShadowNodeT>
class NgNativeSplitPaneComponentDescriptor final : public ConcreteComponentDescriptor<ShadowNodeT> {
 public:
  using ConcreteComponentDescriptor<ShadowNodeT>::ConcreteComponentDescriptor;

  void adopt(ShadowNode &shadowNode) const override
  {
    auto &layoutable = static_cast<YogaLayoutableShadowNode &>(shadowNode);
    const auto &state = static_cast<const typename ShadowNodeT::ConcreteState &>(*shadowNode.getState());
    Size size = state.getData().size;
    if (size.width > 0 && size.height > 0) {
      layoutable.setSize(size);
      layoutable.setPositionType(YGPositionTypeAbsolute);
    }
    ConcreteComponentDescriptor<ShadowNodeT>::adopt(shadowNode);
  }
};

using NgNativeSplitViewComponentDescriptor = ConcreteComponentDescriptor<NgNativeSplitViewShadowNode>;
using NgNativeSidebarComponentDescriptor = NgNativeSplitPaneComponentDescriptor<NgNativeSidebarShadowNode>;
using NgNativeSplitContentComponentDescriptor = NgNativeSplitPaneComponentDescriptor<NgNativeSplitContentShadowNode>;

} // namespace facebook::react
