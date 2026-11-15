// The surfaces a runtime has, kept apart from the runtime so a reload never makes the UI thread
// wait. While a reload runs, a surface started, stopped or resized is only written down here, and
// the reload brings the new runtime to match the book, step by step, before it ends. Not locked:
// the runtime holds its own lock around each call. Header-only, and toolkit-free.
#pragma once

#include <react/renderer/core/ReactPrimitives.h>

#include <map>
#include <optional>
#include <set>
#include <vector>

namespace ngn {

template <class Surface>
class SurfaceBook {
 public:
  // Each answers whether the caller should apply the change to the runtime now: not during a
  // reload, which applies it.
  bool start(facebook::react::SurfaceId id, Surface surface) {
    surfaces_[id] = std::move(surface);
    if (reloading_) {
      changed_.insert(id);
    }
    return !reloading_;
  }
  bool stop(facebook::react::SurfaceId id) {
    return surfaces_.erase(id) != 0 && !reloading_;
  }
  // Changes a surface the book has with `change`.
  template <class Change>
  bool update(facebook::react::SurfaceId id, Change change) {
    auto it = surfaces_.find(id);
    if (it == surfaces_.end()) {
      return false;
    }
    change(it->second);
    if (reloading_) {
      changed_.insert(id);
    }
    return !reloading_;
  }

  bool reloading() const {
    return reloading_;
  }
  // False when a reload is running already.
  bool beginReload() {
    if (reloading_) {
      return false;
    }
    reloading_ = true;
    return true;
  }

  struct Step {
    std::vector<std::pair<facebook::react::SurfaceId, Surface>> start;
    std::vector<facebook::react::SurfaceId> stop;
    // Running surfaces the book changed since the reload started them, to apply as they are now.
    std::vector<std::pair<facebook::react::SurfaceId, Surface>> update;
  };
  // What the reloaded runtime, running `started`, must start, stop and update to match the book.
  // Nothing when it matches, which ends the reload: from then on changes are applied by their
  // callers.
  std::optional<Step> settle(const std::set<facebook::react::SurfaceId> &started) {
    Step step;
    for (const auto &[id, surface] : surfaces_) {
      if (!started.contains(id)) {
        step.start.emplace_back(id, surface);
      } else if (changed_.contains(id)) {
        step.update.emplace_back(id, surface);
      }
    }
    for (auto id : started) {
      if (!surfaces_.contains(id)) {
        step.stop.push_back(id);
      }
    }
    // A start or an update carries every change so far.
    changed_.clear();
    if (step.start.empty() && step.stop.empty() && step.update.empty()) {
      reloading_ = false;
      return std::nullopt;
    }
    return step;
  }

  // Every surface, for a reload with no runtime to restart them on.
  const std::map<facebook::react::SurfaceId, Surface> &surfaces() const {
    return surfaces_;
  }

 private:
  std::map<facebook::react::SurfaceId, Surface> surfaces_;
  // Surfaces started or changed during the reload, since the last step.
  std::set<facebook::react::SurfaceId> changed_;
  bool reloading_{false};
};

} // namespace ngn
