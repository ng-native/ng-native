#include "ngn/safe-areas.h"

#include "ngn/library-glue.h"

#include <algorithm>
#include <string_view>

namespace ngn {

EdgeInsets insetsWithin(const ContainerInsets &container, const Rect &frame) {
  auto clamp = [](double v) { return static_cast<facebook::react::Float>(std::max(0.0, v)); };
  return EdgeInsets{
      .left = clamp(container.insets.left - frame.origin.x),
      .top = clamp(container.insets.top - frame.origin.y),
      .right = clamp(container.insets.right - (container.size.width - frame.origin.x - frame.size.width)),
      .bottom = clamp(container.insets.bottom - (container.size.height - frame.origin.y - frame.size.height)),
  };
}

void SafeAreas::created(const ShadowView &view) {
  std::string_view name = view.componentName;
  if (name == "RNCSafeAreaProvider") {
    tracked_[view.tag] = Tracked{.kind = Kind::Provider};
  } else if (name == "RNCSafeAreaView" || name == "RNSSafeAreaView") {
    tracked_[view.tag] = Tracked{.kind = Kind::View};
  }
}

void SafeAreas::deleted(Tag tag) {
  tracked_.erase(tag);
}

void SafeAreas::setContainer(Tag root, const ContainerInsets &metrics) {
  containers_[root] = metrics;
}

void SafeAreas::removeContainer(Tag root) {
  containers_.erase(root);
}

void SafeAreas::settle(const ViewTree &tree) {
  for (auto &[tag, tracked] : tracked_) {
    // The container the view is in: the nearest ancestor with metrics.
    const ContainerInsets *container = nullptr;
    Tag root = -1;
    for (Tag at = tag; at != -1;) {
      if (auto it = containers_.find(at); it != containers_.end()) {
        container = &it->second;
        root = at;
        break;
      }
      const auto *node = tree.find(at);
      at = node == nullptr ? -1 : node->parent;
    }
    const auto *node = tree.find(tag);
    auto origin = container == nullptr ? std::nullopt : tree.originIn(tag, root);
    if (node == nullptr || !origin) {
      continue;
    }
    Rect frame{*origin, node->view.layoutMetrics.frame.size};
    auto insets = insetsWithin(*container, frame);
    bool changed = !tracked.known || insets != tracked.insets ||
        (tracked.kind == Kind::Provider && frame != tracked.frame);
    if (!changed) {
      continue;
    }
    tracked.known = true;
    tracked.insets = insets;
    tracked.frame = frame;
    if (tracked.kind == Kind::Provider) {
      emitInsetsChange(*node, insets, frame, container->titlebarLeading);
    } else {
      setStateInsets(*node, insets);
    }
  }
}

void SafeAreas::emitInsetsChange(const ViewTree::Node &provider, EdgeInsets insets, Rect frame, double titlebarLeading) {
  if (!provider.view.eventEmitter) {
    return;
  }
  provider.view.eventEmitter->dispatchEvent(
      "insetsChange",
      folly::dynamic::object(
          "insets",
          folly::dynamic::object("top", insets.top)("right", insets.right)("bottom", insets.bottom)("left", insets.left))(
          "frame",
          folly::dynamic::object("x", frame.origin.x)("y", frame.origin.y)("width", frame.size.width)(
              "height", frame.size.height))("titlebarLeading", titlebarLeading));
}

void SafeAreas::setStateInsets(const ViewTree::Node &view, EdgeInsets insets) {
  if (!view.view.state) {
    return;
  }
  for (const auto &set : libraryGlue().safeAreaStates) {
    if (set(*view.view.state, insets)) {
      return;
    }
  }
}

} // namespace ngn
