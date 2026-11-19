// Which launch's first frame starts its success timer (updates.h). A launch, the first or a
// reload's, owes that frame once its bundle has loaded, and a frame counts for it only when its own
// JavaScript instance mounted the content (MountingManager::mountedBy) and no reload has begun
// since. The last launch's content still on screen, or a mount it queued before the reload, never
// counts for the new one, and a reload whose bundle did not load owes nothing, a reload of the same
// launch included. Main thread only.
// Toolkit-free.
#pragma once

#include <cstdint>
#include <optional>

namespace ngn {

// How long a launch's first frame stays on screen before the launch counts as a success: an update
// that crashes before then is rolled back at the next launch.
constexpr double kLaunchSuccessSeconds = 10;

class LaunchFrame {
 public:
  // The launch `generation` (UpdatesClient::launchGeneration) loaded its bundle into the mounting
  // instance `instance` (MountingManager::instance).
  void loaded(uint64_t generation, uint64_t instance) {
    owed_ = Owed{generation, instance};
  }

  // A reload began, of this launch or a new one: the instance it replaces owes nothing now.
  void reloadBegan() {
    owed_.reset();
  }

  // A window shows content the instance `instance` mounted while `current` is the launch running:
  // the launch whose success timer starts now, once.
  std::optional<uint64_t> shown(uint64_t instance, uint64_t current) {
    if (!owed_ || owed_->generation != current || owed_->instance != instance) {
      return std::nullopt;
    }
    auto generation = owed_->generation;
    owed_.reset();
    return generation;
  }

 private:
  struct Owed {
    uint64_t generation;
    uint64_t instance;
  };
  std::optional<Owed> owed_;
};

} // namespace ngn
