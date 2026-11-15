#include "ngn/layout-animations.h"

#include <react/renderer/animations/LayoutAnimationDriver.h>

#include <mutex>

using namespace facebook::react;

namespace ngn {

namespace {

std::mutex gMutex;
std::function<void(bool)> gRunning;

class Status final : public LayoutAnimationStatusDelegate {
 public:
  void onAnimationStarted() override {
    report(true);
  }
  void onAllAnimationsComplete() override {
    report(false);
  }

 private:
  static void report(bool running) {
    std::function<void(bool)> handler;
    {
      std::lock_guard lock(gMutex);
      handler = gRunning;
    }
    if (handler) {
      handler(running);
    }
  }
};

Status gStatus;
// The driver of the newest scheduler. ReactHost destroys a scheduler before it makes the next, so
// the one replaced here has no scheduler left to outlive.
std::shared_ptr<LayoutAnimationDriver> gDriver;

} // namespace

std::unique_ptr<Scheduler> makeScheduler(const SchedulerToolbox &toolbox, SchedulerDelegate *delegate) {
  auto context = toolbox.contextContainer;
  gDriver = std::make_shared<LayoutAnimationDriver>(toolbox.runtimeExecutor, context, &gStatus);
  auto scheduler = std::make_unique<Scheduler>(toolbox, gDriver.get(), delegate);
  // The driver interpolates the frames each surface mounts, as RCTScheduler sets it up.
  std::weak_ptr<LayoutAnimationDriver> driver = gDriver;
  scheduler->uiManagerShouldAddOnSurfaceStartCallback([driver](const ShadowTree &tree) {
    tree.getMountingCoordinator()->setMountingOverrideDelegate(driver);
  });
  return scheduler;
}

void onLayoutAnimationsRunning(std::function<void(bool)> handler) {
  std::lock_guard lock(gMutex);
  gRunning = std::move(handler);
}

} // namespace ngn
