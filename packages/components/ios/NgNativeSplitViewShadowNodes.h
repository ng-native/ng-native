// `<split-view>` on an iPad: the C++ side of the three Fabric components the host draws it with.
// `NgNativeSplitView` is the UISplitViewController; `NgNativeSidebar` (props `collapsed`,
// `paneMinWidth`, `paneMaxWidth`, the event `topSidebarCollapse`) and `NgNativeSplitContent` are
// its two columns. Each column's size is the column controller's, which the view puts in the
// node's state, and the descriptor gives Yoga as the node's size, so what is inside a column lays
// out at the width UIKit gives it.
#pragma once

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/components/view/YogaLayoutableShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>

namespace facebook::react {

extern const char NgNativeSplitViewComponentName[];
extern const char NgNativeSidebarComponentName[];
extern const char NgNativeSplitContentComponentName[];

// A column's size, as UIKit laid it out: zero until the view has been placed in its column.
class NgNativeSplitPaneState final {
 public:
  NgNativeSplitPaneState() = default;
  explicit NgNativeSplitPaneState(Size size) : size(size) {}

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

using NgNativeSidebarShadowNode = ConcreteViewShadowNode<
    NgNativeSidebarComponentName,
    NgNativeSidebarProps,
    NgNativeSidebarEventEmitter,
    NgNativeSplitPaneState>;

using NgNativeSplitContentShadowNode = ConcreteViewShadowNode<
    NgNativeSplitContentComponentName,
    NgNativeSplitProps,
    ViewEventEmitter,
    NgNativeSplitPaneState>;

// A column: once UIKit has sized it, that size is the node's, out of the split view's flow.
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
