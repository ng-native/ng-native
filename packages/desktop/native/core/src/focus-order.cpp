#include "ngn/focus-order.h"

#include "ngn/desktop-props.h"
#include "ngn/native-controls.h"

#include <react/renderer/core/Props.h>

#include <algorithm>

using namespace facebook::react;

namespace ngn {

namespace {

struct Candidate {
  Tag tag;
  int tabIndex;
};

const DesktopProps *desktopOf(const ViewTree::Node &node) {
  const auto *holder = node.view.props ? dynamic_cast<const HasDesktopProps *>(node.view.props.get()) : nullptr;
  return holder != nullptr ? &holder->desktop : nullptr;
}

void collect(const ViewTree &tree, Tag tag, Tag root, TabReach reach, std::vector<Candidate> &out) {
  const auto *node = tree.find(tag);
  if (node == nullptr || tree.covered(tag) || (tag != root && tree.isContainerRoot(tag)) ||
      node->view.layoutMetrics.displayType == DisplayType::None) {
    return;
  }
  std::string_view name = node->view.componentName;
  bool textInput = name == "TextInput";
  bool control = controlKind(name).has_value() && name != std::string_view(ActivityIndicatorControlComponentName);
  const auto *desktop = desktopOf(*node);
  auto tabIndex = desktop ? desktop->tabIndex : std::nullopt;
  auto focusable = desktop ? desktop->focusable : std::nullopt;
  bool takesFocus = tabIndex ? *tabIndex >= 0 : focusable.value_or(textInput || control);
  if (takesFocus && (reach == TabReach::All || textInput)) {
    out.push_back({tag, tabIndex.value_or(0)});
  }
  for (auto child : node->children) {
    collect(tree, child, root, reach, out);
  }
}

} // namespace

std::vector<Tag> tabOrder(const ViewTree &tree, Tag root, TabReach reach) {
  std::vector<Candidate> found;
  collect(tree, root, root, reach, found);
  // Positive tabIndex first, lowest first; the rest keep tree order.
  std::stable_sort(found.begin(), found.end(), [](const Candidate &a, const Candidate &b) {
    bool aExplicit = a.tabIndex > 0, bExplicit = b.tabIndex > 0;
    if (aExplicit != bExplicit) {
      return aExplicit;
    }
    return aExplicit && a.tabIndex < b.tabIndex;
  });
  std::vector<Tag> order;
  order.reserve(found.size());
  for (const auto &c : found) {
    order.push_back(c.tag);
  }
  return order;
}

std::optional<Tag> nextInTabOrder(
    const ViewTree &tree,
    Tag root,
    std::optional<Tag> from,
    bool backwards,
    TabReach reach) {
  auto order = tabOrder(tree, root, reach);
  if (order.empty()) {
    return std::nullopt;
  }
  auto at = from ? std::find(order.begin(), order.end(), *from) : order.end();
  if (at == order.end()) {
    return backwards ? order.back() : order.front();
  }
  auto index = static_cast<size_t>(at - order.begin());
  auto size = order.size();
  return order[backwards ? (index + size - 1) % size : (index + 1) % size];
}

} // namespace ngn
