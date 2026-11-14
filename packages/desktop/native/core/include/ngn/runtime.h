// One React Native runtime (ReactHost over Hermes) for every window of the app, with its surfaces.
// Toolkit-free: a backend supplies the mounting manager, the text measurer, its modules and the
// event beat, and owns the windows the surfaces mount into.
#pragma once

#include "ngn/module-registry.h"
#include "ngn/mounting-manager.h"
#include "ngn/text-measurer.h"

#include <react/renderer/graphics/Size.h>

#include <memory>
#include <string>

namespace facebook::react {
class ReactHost;
class RunLoopObserverManager;
} // namespace facebook::react

namespace ngn {

struct SurfaceMetrics {
  facebook::react::Size size{};
  // Device pixels per point.
  float pointScale{2};
  // The text size multiplier.
  float fontScale{1};
};

class Runtime {
 public:
  Runtime(
      std::shared_ptr<MountingManager> mounting,
      std::shared_ptr<const TextMeasurer> textMeasurer,
      std::shared_ptr<ModuleRegistry> modules);
  ~Runtime();
  Runtime(const Runtime &) = delete;
  Runtime &operator=(const Runtime &) = delete;

  // Loads a bundle from disk (JavaScript or Hermes bytecode). False if it could not be read.
  bool loadBundle(const std::string &path);

  void startSurface(SurfaceId surfaceId, const std::string &moduleName, const SurfaceMetrics &metrics);
  void updateSurface(SurfaceId surfaceId, const SurfaceMetrics &metrics);

  // The event beat: the backend calls it each time its UI thread's run loop is about to wait.
  void beat();

  // Stops every surface and tears the runtime down, before the process exits.
  void shutdown();

 private:
  std::shared_ptr<MountingManager> mounting_;
  std::shared_ptr<ModuleRegistry> modules_;
  std::shared_ptr<facebook::react::RunLoopObserverManager> runLoop_;
  std::unique_ptr<facebook::react::ReactHost> host_;
};

} // namespace ngn
