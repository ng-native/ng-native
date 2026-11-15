#include "ngn/split-view.h"

#include "ngn/desktop-view-props.h"
#include "ngn/native-controls.h"

#include <react/renderer/core/propsConversions.h>

#include <algorithm>
#include <string_view>

using namespace facebook::react;

namespace ngn {

const char SplitViewComponentName[] = "NgNativeSplitView";
const char SidebarComponentName[] = "NgNativeSidebar";
const char SplitContentComponentName[] = "NgNativeSplitContent";
const char SidebarSectionComponentName[] = "NgNativeSidebarSection";
const char SidebarItemComponentName[] = "NgNativeSidebarItem";

SplitPaneProps::SplitPaneProps(const PropsParserContext &context, const SplitPaneProps &sourceProps, const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      collapsed(convertRawProp(context, rawProps, "collapsed", sourceProps.collapsed, false)),
      paneMinWidth(convertRawProp(context, rawProps, "paneMinWidth", sourceProps.paneMinWidth, Float{0})),
      paneMaxWidth(convertRawProp(context, rawProps, "paneMaxWidth", sourceProps.paneMaxWidth, Float{0})),
      autosaveName(convertRawProp(context, rawProps, "autosaveName", sourceProps.autosaveName, std::string{})) {}

SidebarSectionProps::SidebarSectionProps(
    const PropsParserContext &context,
    const SidebarSectionProps &sourceProps,
    const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      title(convertRawProp(context, rawProps, "title", sourceProps.title, std::string{})),
      collapsible(convertRawProp(context, rawProps, "collapsible", sourceProps.collapsible, false)) {}

SidebarItemProps::SidebarItemProps(
    const PropsParserContext &context,
    const SidebarItemProps &sourceProps,
    const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      label(convertRawProp(context, rawProps, "label", sourceProps.label, std::string{})),
      badge(convertRawProp(context, rawProps, "badge", sourceProps.badge, std::string{})),
      sfSymbol(convertRawProp(context, rawProps, "sfSymbol", sourceProps.sfSymbol, std::string{})),
      drawable(convertRawProp(context, rawProps, "drawable", sourceProps.drawable, std::string{})),
      selected(convertRawProp(context, rawProps, "selected", sourceProps.selected, false)) {}

void SidebarSectionShadowNode::applySourceListLayout() const {
  ensureUnsealed();
  const auto &props = getConcreteProps();
  auto style = yogaNode_.style();
  bool titled = !props.title.empty();
  style.setPadding(
      facebook::yoga::Edge::Top,
      titled ? facebook::yoga::StyleLength::points(kSidebarHeaderHeight)
             : props.yogaStyle.padding(facebook::yoga::Edge::Top));
  style.setDimension(
      facebook::yoga::Dimension::Height,
      titled && getStateData().collapsed ? facebook::yoga::StyleSizeLength::points(kSidebarHeaderHeight)
                                         : props.yogaStyle.dimension(facebook::yoga::Dimension::Height));
  if (!(style == yogaNode_.style())) {
    yogaNode_.setStyle(style);
    yogaNode_.setDirty(true);
  }
}

void SidebarSectionComponentDescriptor::adopt(ShadowNode &shadowNode) const {
  static_cast<const SidebarSectionShadowNode &>(shadowNode).applySourceListLayout();
  ConcreteComponentDescriptor::adopt(shadowNode);
}

void SidebarItemShadowNode::applySourceListLayout() const {
  ensureUnsealed();
  const auto &props = getConcreteProps();
  auto style = yogaNode_.style();
  auto minHeight = props.yogaStyle.minDimension(facebook::yoga::Dimension::Height);
  bool tallEnough = minHeight.isPoints() && minHeight.value().isDefined() &&
      minHeight.value().unwrap() >= kSidebarRowHeight;
  style.setMinDimension(
      facebook::yoga::Dimension::Height,
      tallEnough ? minHeight : facebook::yoga::StyleSizeLength::points(kSidebarRowHeight));
  Float width = getStateData().size.width;
  style.setDimension(
      facebook::yoga::Dimension::Width,
      width > 0 ? facebook::yoga::StyleSizeLength::points(width)
                : props.yogaStyle.dimension(facebook::yoga::Dimension::Width));
  if (!(style == yogaNode_.style())) {
    yogaNode_.setStyle(style);
    yogaNode_.setDirty(true);
  }
}

void SidebarItemComponentDescriptor::adopt(ShadowNode &shadowNode) const {
  static_cast<const SidebarItemShadowNode &>(shadowNode).applySourceListLayout();
  ConcreteComponentDescriptor::adopt(shadowNode);
}

namespace {

bool named(const ViewTree::Node *node, const char *name) {
  return node != nullptr && std::string_view(node->view.componentName) == name;
}

bool isSection(const ViewTree::Node *node) {
  return named(node, SidebarSectionComponentName);
}

bool isItem(const ViewTree::Node *node) {
  return named(node, SidebarItemComponentName);
}

SidebarGroup group(const ViewTree &tree, const ViewTree::Node &section) {
  SidebarGroup out;
  out.tag = section.view.tag;
  if (const auto *props = dynamic_cast<const SidebarSectionProps *>(section.view.props.get())) {
    out.title = props->title;
    out.collapsible = props->collapsible;
  }
  for (Tag child : section.children) {
    const auto *node = tree.find(child);
    if (!isItem(node)) {
      continue;
    }
    SidebarRow row{.tag = child, .custom = !node->children.empty()};
    if (const auto *props = dynamic_cast<const SidebarItemProps *>(node->view.props.get())) {
      row.label = props->label;
      row.badge = props->badge;
      row.sfSymbol = props->sfSymbol;
      row.selected = props->selected;
    }
    out.rows.push_back(std::move(row));
  }
  return out;
}

} // namespace

std::vector<SourceList> sourceLists(const ViewTree &tree, Tag parent) {
  std::vector<SourceList> lists;
  const auto *node = tree.find(parent);
  if (node == nullptr) {
    return lists;
  }
  bool inRun = false;
  for (Tag child : node->children) {
    const auto *section = tree.find(child);
    if (!isSection(section)) {
      inRun = false;
      continue;
    }
    if (!inRun) {
      lists.emplace_back();
      inRun = true;
    }
    lists.back().groups.push_back(group(tree, *section));
  }
  return lists;
}

bool rowContentTakesClick(const ViewTree &tree, const std::vector<Tag> &chain) {
  for (size_t i = 1; i < chain.size(); i++) {
    const auto *node = tree.find(chain[i]);
    if (node == nullptr) {
      continue;
    }
    std::string_view name = node->view.componentName;
    if (name == "TextInput" || controlKind(name)) {
      return true;
    }
    if (node->view.props) {
      auto desktop = desktopProps(*node->view.props);
      if (desktop.focusable.value_or(false) || desktop.tabIndex.value_or(-1) >= 0) {
        return true;
      }
    }
  }
  return false;
}

void Sidebars::childrenChanged(const ViewTree &tree, Tag parent) {
  // Resolved in settle, once the transaction has put every node in its place.
  dirtyParents_.insert(parent);
  if (const auto *parentNode = tree.find(parent)) {
    for (Tag child : parentNode->children) {
      const auto *node = tree.find(child);
      bool splits = named(node, SplitViewComponentName) || named(node, "RNSTabsHostIOS");
      if (splits && !placed_.contains(child) &&
          std::find(newSplits_.begin(), newSplits_.end(), child) == newSplits_.end()) {
        newSplits_.push_back(child);
      }
    }
  }
}

void Sidebars::propsChanged(const ViewTree &tree, Tag tag) {
  const auto *node = tree.find(tag);
  if (isSection(node) || isItem(node)) {
    dirtyParents_.insert(tag);
  }
}

void Sidebars::deleted(Tag tag) {
  dirtyParents_.erase(tag);
  lists_.erase(tag);
  std::erase(newSplits_, tag);
  placed_.erase(tag);
  std::erase_if(windowSplits_, [tag](const auto &entry) { return entry.second == tag; });
}

namespace {

// The parent whose children a dirty tag's source lists are: an item's section's parent, a
// section's parent, or the tag itself.
Tag listParent(const ViewTree &tree, Tag tag) {
  const auto *node = tree.find(tag);
  if (isItem(node)) {
    node = tree.find(node->parent);
  }
  if (isSection(node)) {
    return node->parent;
  }
  return tag;
}

// Whether a split view is inside something that keeps it from being its window's: another split
// view, a modal or a tabs host. Nothing when it is not connected to the surface's root.
std::optional<bool> nested(const ViewTree &tree, Tag split, SurfaceId surfaceId) {
  bool inside = false;
  const auto *node = tree.find(split);
  while (node != nullptr && node->view.tag != surfaceId) {
    node = tree.find(node->parent);
    if (node == nullptr) {
      return std::nullopt;
    }
    std::string_view name = node->view.componentName;
    inside = inside || name == SplitViewComponentName || name == "ModalHostView" || name == "RNSTabsHostIOS" ||
        name == "RNSTabsHost";
  }
  return node == nullptr ? std::nullopt : std::optional<bool>(inside);
}

int depth(const ViewTree &tree, Tag tag) {
  int d = 0;
  for (const auto *node = tree.find(tag); node != nullptr && node->parent != -1; node = tree.find(node->parent)) {
    d++;
  }
  return d;
}

} // namespace

Sidebars::Changes Sidebars::settle(const ViewTree &tree, SurfaceId surfaceId) {
  Changes changes;

  auto splits = std::move(newSplits_);
  newSplits_.clear();
  std::erase_if(splits, [&](Tag tag) { return !tree.contains(tag); });
  std::stable_sort(splits.begin(), splits.end(), [&](Tag a, Tag b) { return depth(tree, a) < depth(tree, b); });
  for (Tag split : splits) {
    auto inside = nested(tree, split, surfaceId);
    if (!inside) {
      // Not in the surface yet: decided once it is.
      newSplits_.push_back(split);
      continue;
    }
    placed_.insert(split);
    bool window = !*inside && !windowSplits_.contains(surfaceId);
    if (window) {
      windowSplits_[surfaceId] = split;
    }
    changes.splitViews.push_back({.tag = split, .window = window});
  }

  auto dirty = std::move(dirtyParents_);
  dirtyParents_.clear();
  std::unordered_set<Tag> parents;
  for (Tag tag : dirty) {
    parents.insert(listParent(tree, tag));
  }
  std::vector<Tag> ordered(parents.begin(), parents.end());
  std::sort(ordered.begin(), ordered.end());
  for (Tag parent : ordered) {
    if (parent == -1) {
      continue;
    }
    auto lists = sourceLists(tree, parent);
    auto known = lists_.find(parent);
    bool had = known != lists_.end();
    if (had ? known->second == lists : lists.empty()) {
      continue;
    }
    if (lists.empty()) {
      lists_.erase(parent);
    } else {
      lists_[parent] = lists;
    }
    changes.lists.push_back({.parent = parent, .lists = std::move(lists)});
  }
  return changes;
}

std::optional<bool> SidebarCollapse::propChanged(bool collapsed) {
  prop_ = collapsed;
  if (toolkit_ == collapsed) {
    return std::nullopt;
  }
  toolkit_ = collapsed;
  return collapsed;
}

bool SidebarCollapse::toolkitChanged(bool collapsed) {
  if (toolkit_ == collapsed) {
    return false;
  }
  toolkit_ = collapsed;
  return collapsed != prop_;
}

bool FrameSizes::report(Tag tag, Size size) {
  bool first = pending_.empty();
  pending_[tag] = size;
  return first;
}

std::vector<std::pair<Tag, Size>> FrameSizes::flush() {
  std::vector<std::pair<Tag, Size>> out;
  for (const auto &[tag, size] : pending_) {
    auto applied = applied_.find(tag);
    if (applied == applied_.end() || applied->second != size) {
      applied_[tag] = size;
      out.emplace_back(tag, size);
    }
  }
  pending_.clear();
  std::sort(out.begin(), out.end(), [](const auto &a, const auto &b) { return a.first < b.first; });
  return out;
}

void FrameSizes::forget(Tag tag) {
  pending_.erase(tag);
  applied_.erase(tag);
}

} // namespace ngn
