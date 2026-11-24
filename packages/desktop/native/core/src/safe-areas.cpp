#include "ngn/safe-areas.h"

#include "ngn/library-glue.h"

#include <algorithm>
#include <string_view>
#include <utility>
#include <vector>

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

double titlebarLeading(double minX, double maxX, double width, bool rightToLeft) {
  if (maxX <= 0 || minX >= width) {
    return 0;
  }
  return rightToLeft ? width - minX : maxX;
}

double titlebarTrailing(double minX, double maxX, double width, bool rightToLeft) {
  if (maxX <= 0 || minX >= width) {
    return 0;
  }
  return rightToLeft ? maxX : width - minX;
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

namespace {

using facebook::react::Float;

// Where one edge of a view goes when the content edge of a safe-area view it is in moves from
// `mounted` to `pending`, for a top or left edge (`inward` 1, the content edge moving in as it
// grows) or a bottom or right one (-1): a view at the content edge, or past it, moves with it, and
// one inside it stays, unless the content edge moves in past it and pushes it along.
Float follow(Float edge, Float mounted, Float pending, Float inward) {
  if ((edge - mounted) * inward <= 0.01) {
    return edge + pending - mounted;
  }
  return inward > 0 ? std::max(edge, pending) : std::min(edge, pending);
}

// Where a view mounted at `frame` will be once the safe-area view it is in has its content box
// moved from `mounted` to `pending`, every rect in their container.
Rect placedIn(const Rect &frame, const Rect &mounted, const Rect &pending) {
  Float left = follow(frame.getMinX(), mounted.getMinX(), pending.getMinX(), 1);
  Float top = follow(frame.getMinY(), mounted.getMinY(), pending.getMinY(), 1);
  Float right = follow(frame.getMaxX(), mounted.getMaxX(), pending.getMaxX(), -1);
  Float bottom = follow(frame.getMaxY(), mounted.getMaxY(), pending.getMaxY(), -1);
  return {{left, top}, {std::max<Float>(0, right - left), std::max<Float>(0, bottom - top)}};
}

} // namespace

bool SafeAreas::settle(const ViewTree &tree) {
  // Outer views before the views inside them. The views' new insets reach the layout only in the
  // commit after this, so a view inside another is measured from where the other's new insets
  // will put it, not from where it is mounted: there, it would be told the insets the outer view
  // is about to take, and the commit would apply them twice before the next one settles.
  std::vector<std::pair<int, Tag>> order;
  order.reserve(tracked_.size());
  for (const auto &entry : tracked_) {
    int depth = 0;
    for (const auto *node = tree.find(entry.first); node != nullptr; node = tree.find(node->parent)) {
      ++depth;
    }
    order.emplace_back(depth, entry.first);
  }
  std::sort(order.begin(), order.end());
  // Each safe-area view's content box this pass, in its container: where it is mounted, and where
  // its new insets and its ancestors' will put it.
  struct Content {
    Rect mounted;
    Rect pending;
  };
  std::unordered_map<Tag, Content> contents;

  bool told = false;
  for (auto [depth, tag] : order) {
    auto &tracked = tracked_.at(tag);
    // The container the view is in: the nearest ancestor with metrics. And the nearest safe-area
    // view it is in below that.
    const ContainerInsets *container = nullptr;
    const Content *within = nullptr;
    Tag root = -1;
    for (Tag at = tag; at != -1;) {
      if (auto it = containers_.find(at); it != containers_.end()) {
        container = &it->second;
        root = at;
        break;
      }
      if (auto it = contents.find(at); within == nullptr && it != contents.end()) {
        within = &it->second;
      }
      const auto *node = tree.find(at);
      at = node == nullptr ? -1 : node->parent;
    }
    const auto *node = tree.find(tag);
    auto origin = container == nullptr ? std::nullopt : tree.originIn(tag, root);
    if (node == nullptr || !origin) {
      continue;
    }
    Rect mountedFrame{*origin, node->view.layoutMetrics.frame.size};
    Rect frame = within == nullptr ? mountedFrame : placedIn(mountedFrame, within->mounted, within->pending);
    // A view that moves itself by its insets is measured from where it would be without them, as
    // iOS measures it against its provider; from where the margin put it, it would be told it is
    // clear, drop the margin, and move back.
    auto mounted = tracked.kind == Kind::View ? applied(*node, std::nullopt) : SafeAreaApplied{};
    Rect unmoved = outsetBy(frame, mounted.margin);
    auto insets = insetsWithin(*container, unmoved);
    if (tracked.kind == Kind::View) {
      auto pending = applied(*node, insets);
      contents[tag] = {
          .mounted = insetBy(mountedFrame, mounted.padding),
          .pending = insetBy(insetBy(unmoved, pending.margin), pending.padding),
      };
    }
    bool changed = !tracked.known || insets != tracked.insets ||
        (tracked.kind == Kind::Provider &&
         (frame != tracked.frame || container->titlebarLeading != tracked.titlebarLeading ||
          container->titlebarTrailing != tracked.titlebarTrailing));
    if (!changed) {
      continue;
    }
    told = true;
    tracked.known = true;
    tracked.insets = insets;
    tracked.frame = frame;
    tracked.titlebarLeading = container->titlebarLeading;
    tracked.titlebarTrailing = container->titlebarTrailing;
    if (tracked.kind == Kind::Provider) {
      emitInsetsChange(*node, insets, frame, container->titlebarLeading, container->titlebarTrailing);
    } else {
      setStateInsets(*node, insets);
    }
  }
  return told;
}

void SafeAreas::emitInsetsChange(
    const ViewTree::Node &provider,
    EdgeInsets insets,
    Rect frame,
    double titlebarLeading,
    double titlebarTrailing) {
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
              "height", frame.size.height))("titlebarLeading", titlebarLeading)("titlebarTrailing", titlebarTrailing));
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

namespace ngn {

SafeAreaApplied SafeAreas::applied(const ViewTree::Node &view, std::optional<EdgeInsets> insets) const {
  for (const auto &read : libraryGlue().safeAreaApplied) {
    if (auto applied = read(view.view, insets)) {
      return *applied;
    }
  }
  return {};
}

} // namespace ngn
