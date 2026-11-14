#include "ngn/screen-stacks.h"

#include "ngn/screen-presentation.h"

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

bool presented(const ViewTree::Node *node) {
  return node != nullptr && node->view.props && screenPresentation(*node->view.props).has_value();
}

// The index of the last screen pushed rather than presented, or 0.
size_t baseOf(const ViewTree &tree, const std::vector<Tag> &screens) {
  for (size_t i = screens.size(); i > 0; i--) {
    if (!presented(tree.find(screens[i - 1]))) {
      return i - 1;
    }
  }
  return 0;
}

} // namespace

void ScreenStacks::propsChanged(const ViewTree &tree, Tag tag) {
  const auto *node = tree.find(tag);
  if (isScreen(node) && isStack(tree.find(node->parent))) {
    dirty_.insert(node->parent);
  }
}

std::vector<ScreenStacks::Covered> ScreenStacks::takePresented() {
  auto out = std::move(presentedChanges_);
  presentedChanges_.clear();
  return out;
}

void ScreenStacks::childrenChanged(const ViewTree &tree, Tag parent) {
  if (isStack(tree.find(parent))) {
    dirty_.insert(parent);
  }
}

void ScreenStacks::deleted(Tag tag) {
  dirty_.erase(tag);
  tops_.erase(tag);
  presented_.erase(tag);
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
    size_t base = baseOf(tree, screens);
    for (size_t i = 0; i < screens.size(); i++) {
      Tag tag = screens[i];
      bool covered = i < base;
      if (tree.covered(tag) != covered) {
        tree.setCovered(tag, covered);
        changes.push_back({tag, covered});
      }
      bool isPresented = i > base || (i == base && presented(tree.find(tag)));
      if (presented_.contains(tag) != isPresented) {
        if (isPresented) {
          presented_.insert(tag);
        } else {
          presented_.erase(tag);
        }
        presentedChanges_.push_back({tag, isPresented});
      }
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
    const auto *stackNode = tree.find(stack);
    if (stackNode == nullptr) {
      continue;
    }
    std::vector<Tag> screens;
    for (Tag child : stackNode->children) {
      if (isScreen(tree.find(child))) {
        screens.push_back(child);
      }
    }
    if (screens.empty()) {
      continue;
    }
    size_t baseIndex = baseOf(tree, screens);
    const auto *screen = tree.find(screens[baseIndex]);
    if (screen == nullptr || presented(screen)) {
      continue;
    }
    // A cover fills the window under its toolbar, so the topmost one presented over the stack
    // shows its header there, with nothing to go back to. Sheets and popovers draw their own.
    bool cover = false;
    for (size_t i = screens.size(); i > baseIndex + 1; i--) {
      const auto *over = tree.find(screens[i - 1]);
      if (over != nullptr && over->view.props && screenPresentation(*over->view.props) == ModalPresentation::Cover) {
        screen = over;
        cover = true;
        break;
      }
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
        front = FrontHeader{.config = child, .screen = screen->view.tag, .canGoBack = !cover && baseIndex > 0};
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
