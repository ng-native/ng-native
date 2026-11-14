#include "ngn/screen-stacks.h"

#include <algorithm>
#include <string_view>

namespace ngn {

namespace {

bool isStack(const ViewTree::Node *node) {
  return node != nullptr && std::string_view(node->view.componentName) == "RNSScreenStack";
}

bool isScreen(const ViewTree::Node *node) {
  return node != nullptr && std::string_view(node->view.componentName) == "RNSScreen";
}

// A container that is part of the window's content, whose screen in front fills the window's
// toolbar: a split view's content pane, or the content pane a tabs host draws its tab in. A
// sheet's, a popover's or a toolbar item's is not.
bool partOfWindow(const ViewTree::Node *node) {
  if (node == nullptr) {
    return false;
  }
  std::string_view name = node->view.componentName;
  return name == "NgNativeSplitContent" || name == "RNSTabsHostIOS";
}

} // namespace

void ScreenStacks::childrenChanged(const ViewTree &tree, Tag parent) {
  if (isStack(tree.find(parent))) {
    dirty_.insert(parent);
  }
}

void ScreenStacks::deleted(Tag tag) {
  dirty_.erase(tag);
  tops_.erase(tag);
}

Tag ScreenStacks::top(Tag stack) const {
  auto it = tops_.find(stack);
  return it == tops_.end() ? -1 : it->second;
}

std::vector<ScreenStacks::Covered> ScreenStacks::settle(ViewTree &tree) {
  std::vector<Covered> changes;
  auto dirty = std::move(dirty_);
  dirty_.clear();
  for (Tag stack : dirty) {
    const auto *node = tree.find(stack);
    if (!isStack(node)) {
      continue;
    }
    std::vector<Tag> screens;
    for (Tag child : node->children) {
      if (isScreen(tree.find(child))) {
        screens.push_back(child);
      }
    }
    Tag top = screens.empty() ? -1 : screens.back();
    std::vector<Tag> covered(screens.begin(), screens.empty() ? screens.end() : screens.end() - 1);

    for (Tag tag : covered) {
      if (!tree.covered(tag)) {
        tree.setCovered(tag, true);
        changes.push_back({tag, true});
      }
    }
    if (top != -1 && tree.covered(top)) {
      tree.setCovered(top, false);
      changes.push_back({top, false});
    }

    Tag previous = this->top(stack);
    if (top == previous) {
      continue;
    }
    tops_[stack] = top;
    // A popped screen is gone already; a pushed-away one is still in the tree.
    const auto *leaving = previous == -1 ? nullptr : tree.find(previous);
    if (leaving != nullptr && leaving->parent != stack) {
      leaving = nullptr;
    }
    const auto *arriving = top == -1 ? nullptr : tree.find(top);
    if (leaving != nullptr) {
      emit(*leaving, "willDisappear");
    }
    if (arriving != nullptr) {
      emit(*arriving, "willAppear");
    }
    if (leaving != nullptr) {
      emit(*leaving, "disappear");
    }
    if (arriving != nullptr) {
      emit(*arriving, "appear");
    }
    emit(*node, "finishTransitioning");
  }
  return changes;
}

std::optional<ScreenStacks::FrontHeader> ScreenStacks::frontHeader(const ViewTree &tree, Tag root) const {
  std::optional<FrontHeader> front;
  int frontDepth = -1;
  for (const auto &[stack, top] : tops_) {
    const auto *screen = tree.find(top);
    if (screen == nullptr || screen->parent != stack) {
      continue;
    }
    // How deep the stack is in `root`'s container, or not in it at all.
    int depth = 0;
    Tag at = stack;
    for (; at != root && at != -1; depth++) {
      if (tree.covered(at) || (tree.isContainerRoot(at) && !partOfWindow(tree.find(at)))) {
        at = -1;
        break;
      }
      const auto *node = tree.find(at);
      at = node == nullptr ? -1 : node->parent;
    }
    if (at != root || depth <= frontDepth) {
      continue;
    }
    for (Tag child : screen->children) {
      const auto *config = tree.find(child);
      if (config != nullptr && std::string_view(config->view.componentName) == "RNSScreenStackHeaderConfig") {
        int screens = 0;
        for (Tag sibling : tree.find(stack)->children) {
          screens += isScreen(tree.find(sibling)) ? 1 : 0;
        }
        front = FrontHeader{.config = child, .screen = top, .canGoBack = screens > 1};
        frontDepth = depth;
        break;
      }
    }
  }
  return front;
}

void ScreenStacks::emit(const ViewTree::Node &node, const char *event) {
  if (node.view.eventEmitter) {
    node.view.eventEmitter->dispatchEvent(event);
  }
}

} // namespace ngn
