#include "ngn/expo-ui.h"

#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/core/propsConversions.h>

#include <algorithm>

using namespace facebook::react;

namespace ngn {

const char ExpoUIComponentName[] = "ExpoUIView";

namespace {

// The views drawn on macOS, by their iOS names. `EXPO_UI_MACOS` in @ng-native/expo says the same,
// with the SwiftUI view each is and why the others are absent.
const char *const kExpoUIViews[] = {"AlertView", "BackgroundView", "BottomSheetView", "Button", "CapsuleView",
    "ChartView", "CircleView", "ColorPickerView", "ConfirmationDialogView", "ContentUnavailableView", "ContextMenu",
    "ControlGroupView", "DatePickerView", "DisclosureGroupView", "DividerView", "EllipseView", "FormView", "GaugeView",
    "GlassEffectContainerView", "GridView", "GridRowView", "GroupView", "HostView", "HStackView", "ImageView",
    "LabelView", "LabeledContentView", "LazyHStackView", "LazyVStackView", "LinkView", "ListView", "MaskView",
    "MenuView", "NavigationStackView", "OverlayView", "PickerView", "PopoverView", "ProgressView", "RectangleView",
    "RNHostView", "RoundedRectangleView", "ScrollViewComponent", "SectionView", "SecureFieldView", "ShareLinkView",
    "SliderView", "SlotView", "SpacerView", "StepperView", "SwipeActionsView", "TabView", "TextFieldView", "TextView",
    "ToggleView", "UnevenRoundedRectangleView", "VStackView", "ZStackView"};

// Each view's full component name, made once and kept for the life of the process: a descriptor's
// flavor and a ShadowView's componentName point into these.
const std::vector<std::shared_ptr<const std::string>> &componentNames() {
  static const auto names = [] {
    std::vector<std::shared_ptr<const std::string>> out;
    for (const char *view : kExpoUIViews) {
      out.push_back(std::make_shared<const std::string>(std::string(kExpoUIPrefix) + view));
    }
    return out;
  }();
  return names;
}

bool truthy(const folly::dynamic &values, const char *key) {
  auto found = values.find(key);
  return found != values.items().end() && found->second.isBool() && found->second.getBool();
}

} // namespace

const std::vector<std::string> &expoUIViews() {
  static const std::vector<std::string> views(std::begin(kExpoUIViews), std::end(kExpoUIViews));
  return views;
}

std::optional<std::string> expoUIViewName(std::string_view componentName) {
  if (!componentName.starts_with(kExpoUIPrefix)) {
    return std::nullopt;
  }
  std::string view(componentName.substr(kExpoUIPrefix.size()));
  const auto &views = expoUIViews();
  if (std::find(views.begin(), views.end(), view) == views.end()) {
    return std::nullopt;
  }
  return view;
}

ExpoUIProps::ExpoUIProps(const PropsParserContext &context, const ExpoUIProps &sourceProps, const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps), values(sourceProps.values) {
  auto raw = rawProps.toDynamic();
  if (raw.isObject()) {
    for (const auto &[key, value] : raw.items()) {
      if (value.isNull()) {
        values.erase(key);
      } else {
        values[key] = value;
      }
    }
  }
  matchContentsHorizontal = truthy(values, "matchContentsHorizontal");
  matchContentsVertical = truthy(values, "matchContentsVertical");
}

void ExpoUIShadowNode::applyContentSize() {
  const auto &props = getConcreteProps();
  const auto &size = getStateData().contentSize;
  bool width = props.matchContentsHorizontal && size.width > 0;
  bool height = props.matchContentsVertical && size.height > 0;
  if (!width && !height) {
    return;
  }
  ensureUnsealed();
  auto style = yogaNode_.style();
  if (width) {
    style.setDimension(facebook::yoga::Dimension::Width, facebook::yoga::StyleSizeLength::points(size.width));
  }
  if (height) {
    style.setDimension(facebook::yoga::Dimension::Height, facebook::yoga::StyleSizeLength::points(size.height));
  }
  yogaNode_.setStyle(style);
  yogaNode_.setDirty(true);
}

ComponentHandle ExpoUIComponentDescriptor::getComponentHandle() const {
  return reinterpret_cast<ComponentHandle>(getComponentName());
}

ComponentName ExpoUIComponentDescriptor::getComponentName() const {
  return flavor_ ? std::static_pointer_cast<const std::string>(flavor_)->c_str() : ExpoUIComponentName;
}

void ExpoUIComponentDescriptor::adopt(ShadowNode &shadowNode) const {
  static_cast<ExpoUIShadowNode &>(shadowNode).applyContentSize();
  ConcreteComponentDescriptor::adopt(shadowNode);
}

std::vector<ComponentDescriptorProvider> expoUIComponentProviders() {
  std::vector<ComponentDescriptorProvider> out;
  for (const auto &name : componentNames()) {
    out.push_back({
        reinterpret_cast<ComponentHandle>(name->c_str()),
        name->c_str(),
        name,
        &concreteComponentDescriptorConstructor<ExpoUIComponentDescriptor>,
    });
  }
  return out;
}

namespace {

std::optional<std::string> viewName(const ViewTree &tree, Tag tag) {
  const auto *found = tree.find(tag);
  return found == nullptr || found->view.componentName == nullptr ? std::nullopt
                                                                   : expoUIViewName(found->view.componentName);
}

} // namespace

void ExpoUITrees::changed(const ViewTree &tree, Tag tag) {
  for (Tag at = tag; at != -1;) {
    auto name = viewName(tree, at);
    if (!name) {
      return;
    }
    if (*name == "HostView") {
      dirty_.insert(at);
      return;
    }
    at = tree.find(at)->parent;
  }
}

void ExpoUITrees::deleted(Tag tag) {
  dirty_.erase(tag);
  drawn_.erase(tag);
}

std::optional<ExpoUINode> ExpoUITrees::node(const ViewTree &tree, Tag tag) const {
  auto name = viewName(tree, tag);
  if (!name) {
    return std::nullopt;
  }
  const auto &view = tree.find(tag)->view;
  ExpoUINode out{.tag = tag, .name = *name, .eventEmitter = view.eventEmitter};
  if (auto props = std::dynamic_pointer_cast<const ExpoUIProps>(view.props)) {
    out.props = props->values;
  }
  if (*name == "RNHostView") {
    return out;
  }
  for (Tag child : tree.find(tag)->children) {
    // A HostView inside is a SwiftUI tree of its own, and only one in the app's own views can be.
    if (auto c = node(tree, child); c && c->name != "HostView") {
      out.children.push_back(std::move(*c));
    }
  }
  return out;
}

std::vector<ExpoUITrees::Changed> ExpoUITrees::settle(const ViewTree &tree) {
  std::vector<Tag> dirty(dirty_.begin(), dirty_.end());
  dirty_.clear();
  std::sort(dirty.begin(), dirty.end());
  std::vector<Changed> out;
  for (Tag tag : dirty) {
    auto root = node(tree, tag);
    if (!root || root->name != "HostView") {
      continue;
    }
    auto shared = std::make_shared<const ExpoUINode>(std::move(*root));
    auto known = drawn_.find(tag);
    if (known != drawn_.end() && *known->second == *shared) {
      continue;
    }
    drawn_[tag] = shared;
    out.push_back({.host = tag, .root = std::move(shared)});
  }
  return out;
}

} // namespace ngn
