#include "ngn/view-tree.h"

#include <react/renderer/components/view/ViewProps.h>

#include <algorithm>

using namespace facebook::react;

namespace ngn {

void ViewTree::create(const ShadowView &view) {
  nodes_[view.tag] = Node{.view = view};
}

void ViewTree::destroy(Tag tag) {
  auto it = nodes_.find(tag);
  if (it == nodes_.end()) {
    return;
  }
  if (it->second.parent != -1) {
    remove(it->second.parent, tag);
  }
  // Fabric deletes children before their parent, so any left here were already removed.
  for (auto child : it->second.children) {
    if (auto c = nodes_.find(child); c != nodes_.end()) {
      c->second.parent = -1;
    }
  }
  containerRoots_.erase(tag);
  nodes_.erase(it);
}

void ViewTree::insert(Tag parent, Tag child, int index) {
  auto p = nodes_.find(parent);
  auto c = nodes_.find(child);
  if (p == nodes_.end() || c == nodes_.end()) {
    return;
  }
  auto &children = p->second.children;
  auto at = std::min<size_t>(static_cast<size_t>(std::max(index, 0)), children.size());
  children.insert(children.begin() + static_cast<std::ptrdiff_t>(at), child);
  c->second.parent = parent;
}

void ViewTree::remove(Tag parent, Tag child) {
  if (auto p = nodes_.find(parent); p != nodes_.end()) {
    auto &children = p->second.children;
    children.erase(std::remove(children.begin(), children.end(), child), children.end());
  }
  if (auto c = nodes_.find(child); c != nodes_.end() && c->second.parent == parent) {
    c->second.parent = -1;
  }
}

void ViewTree::update(const ShadowView &view) {
  if (auto it = nodes_.find(view.tag); it != nodes_.end()) {
    it->second.view = view;
  }
}

const ViewTree::Node *ViewTree::find(Tag tag) const {
  auto it = nodes_.find(tag);
  return it == nodes_.end() ? nullptr : &it->second;
}

bool ViewTree::contains(Tag tag) const {
  return nodes_.contains(tag);
}

void ViewTree::addContainerRoot(Tag root) {
  containerRoots_.insert(root);
}

void ViewTree::removeContainerRoot(Tag root) {
  containerRoots_.erase(root);
}

std::vector<Tag> ViewTree::hitTest(Tag root, Point point) const {
  std::vector<Tag> chain;
  hitTest(root, root, point, chain);
  std::reverse(chain.begin(), chain.end());
  return chain;
}

// `point` is in `tag`'s own coordinates. Appends the deepest hit first, then each ancestor.
bool ViewTree::hitTest(Tag tag, Tag root, Point point, std::vector<Tag> &chain) const {
  const Node *node = find(tag);
  if (node == nullptr || (tag != root && containerRoots_.contains(tag))) {
    return false;
  }
  const auto &layout = node->view.layoutMetrics;
  if (layout.displayType == DisplayType::None) {
    return false;
  }
  auto props = std::dynamic_pointer_cast<const ViewProps>(node->view.props);
  auto pointerEvents = props ? props->pointerEvents : PointerEventsMode::Auto;
  if (pointerEvents == PointerEventsMode::None) {
    return false;
  }
  // The root covers its whole container: the container reports only points inside itself, and
  // Fabric may never give a surface's root a frame of its own.
  const auto &size = layout.frame.size;
  bool inside = tag == root || (point.x >= 0 && point.y >= 0 && point.x < size.width && point.y < size.height);
  bool clips = (props && props->yogaStyle.overflow() != facebook::yoga::Overflow::Visible) ||
      layout.overflowInset == EdgeInsets{};
  if (clips && !inside) {
    return false;
  }
  if (pointerEvents != PointerEventsMode::BoxOnly) {
    for (auto it = node->children.rbegin(); it != node->children.rend(); ++it) {
      const Node *child = find(*it);
      if (child == nullptr) {
        continue;
      }
      const auto &origin = child->view.layoutMetrics.frame.origin;
      if (hitTest(*it, root, {point.x - origin.x, point.y - origin.y}, chain)) {
        chain.push_back(tag);
        return true;
      }
    }
  }
  if (inside && pointerEvents != PointerEventsMode::BoxNone) {
    chain.push_back(tag);
    return true;
  }
  return false;
}

std::optional<Point> ViewTree::originIn(Tag tag, Tag root) const {
  Point origin{0, 0};
  for (Tag current = tag; current != root;) {
    const Node *node = find(current);
    if (node == nullptr || node->parent == -1) {
      return std::nullopt;
    }
    origin.x += node->view.layoutMetrics.frame.origin.x;
    origin.y += node->view.layoutMetrics.frame.origin.y;
    current = node->parent;
  }
  if (!contains(root)) {
    return std::nullopt;
  }
  return origin;
}

} // namespace ngn
