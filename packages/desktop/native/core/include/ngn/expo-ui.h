// `@expo/ui` on a desktop host: its SwiftUI views as Fabric components, under the names
// `registerExpoUiViews` commits on iOS (ViewManagerAdapter_ExpoUI_<view>), with iOS's props.
//
// Every one of them is one component class, told apart by its name (the descriptor's flavor), whose
// props are kept as they arrive: expo/ui's views take an untyped map of props, and each SwiftUI view
// reads its own. The core keeps the views under each HostView as one tree (ExpoUITrees, below),
// which the backend's view for the HostView draws in SwiftUI, as expo/ui's HostView does with its
// children on iOS. Their own views draw nothing. An RNHostView in the tree is the app's own views
// inside the SwiftUI content: they lay out in Yoga as usual and the toolkit puts its view there.
//
// A HostView with `matchContentsHorizontal` or `matchContentsVertical` is sized by its content: the
// toolkit reports the SwiftUI content's fitting size as the HostView's state, and the HostView takes
// it on the axes it matches, as expo/ui's `setViewSize` does on iOS.
#pragma once

#include "ngn/view-tree.h"

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/componentregistry/ComponentDescriptorProvider.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/EventEmitter.h>

#include <folly/dynamic.h>

#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace ngn {

// The prefix every expo/ui view's component name has: the module's view adapter for `ExpoUI`.
inline constexpr std::string_view kExpoUIPrefix = "ViewManagerAdapter_ExpoUI_";

// The iOS view names the desktop host draws (`EXPO_UI_MACOS` in @ng-native/expo, which a test
// holds to this list), in no order.
const std::vector<std::string> &expoUIViews();

// `HostView` for `ViewManagerAdapter_ExpoUI_HostView`; nothing for a name that is not one of the
// expo/ui views the host draws.
std::optional<std::string> expoUIViewName(std::string_view componentName);

class ExpoUIProps final : public facebook::react::ViewProps {
 public:
  ExpoUIProps() = default;
  ExpoUIProps(
      const facebook::react::PropsParserContext &context,
      const ExpoUIProps &sourceProps,
      const facebook::react::RawProps &rawProps);

  // Every prop as committed, the last value of each: a `null` removes one. Yoga's and the view's
  // own style props are here too, and the SwiftUI views read only their own names.
  folly::dynamic values = folly::dynamic::object();

  // The HostView's, read here for layout.
  bool matchContentsHorizontal{false};
  bool matchContentsVertical{false};
};

// The size of a HostView's SwiftUI content, as the toolkit measured it. Zero until it reports.
struct ExpoUIState {
  facebook::react::Size contentSize{};
};

extern const char ExpoUIComponentName[];

class ExpoUIShadowNode final : public facebook::react::ConcreteViewShadowNode<
                                   ExpoUIComponentName,
                                   ExpoUIProps,
                                   facebook::react::ViewEventEmitter,
                                   ExpoUIState> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  // Takes the content size the state holds on each axis the props match, over the style's.
  void applyContentSize();
};

// One descriptor per expo/ui view name, as its flavor.
class ExpoUIComponentDescriptor final : public facebook::react::ConcreteComponentDescriptor<ExpoUIShadowNode> {
 public:
  using ConcreteComponentDescriptor::ConcreteComponentDescriptor;
  facebook::react::ComponentHandle getComponentHandle() const override;
  facebook::react::ComponentName getComponentName() const override;
  void adopt(facebook::react::ShadowNode &shadowNode) const override;
};

// A provider for each of expoUIViews(), by its full component name.
std::vector<facebook::react::ComponentDescriptorProvider> expoUIComponentProviders();

// One expo/ui view in a HostView's tree: its iOS name, its props, where its events go, and the
// expo/ui views under it. An RNHostView has none: what is under it is the app's own.
struct ExpoUINode {
  facebook::react::Tag tag{-1};
  std::string name;
  folly::dynamic props = folly::dynamic::object();
  facebook::react::SharedEventEmitter eventEmitter;
  std::vector<ExpoUINode> children;
  bool operator==(const ExpoUINode &) const = default;
};

// The HostViews of a surface's views, kept by the mounting manager as it mounts them: which
// HostView each change belongs to, and each HostView's tree when it changed.
class ExpoUITrees {
 public:
  // A view was made or its props or event emitter changed, or `tag`'s children changed.
  void changed(const ViewTree &tree, facebook::react::Tag tag);
  void deleted(facebook::react::Tag tag);

  struct Changed {
    facebook::react::Tag host{-1};
    std::shared_ptr<const ExpoUINode> root;
  };
  // The HostViews whose trees changed since the last call.
  std::vector<Changed> settle(const ViewTree &tree);

 private:
  std::optional<ExpoUINode> node(const ViewTree &tree, facebook::react::Tag tag) const;

  std::unordered_set<facebook::react::Tag> dirty_;
  std::unordered_map<facebook::react::Tag, std::shared_ptr<const ExpoUINode>> drawn_;
};

} // namespace ngn
