#include "ngn/layout-animations.h"

#include <react/renderer/animations/LayoutAnimationDriver.h>
#include <react/renderer/uimanager/UIManagerCommitHook.h>

#include <mutex>

using namespace facebook::react;

namespace ngn {

namespace {

class RetainedLayout final : public UIManagerCommitHook {
 public:
  void commitHookWasRegistered(const UIManager &) noexcept override {}
  void commitHookWasUnregistered(const UIManager &) noexcept override {}

  RootShadowNode::Unshared shadowTreeWillCommit(
      const ShadowTree &,
      const RootShadowNode::Shared &oldRoot,
      const RootShadowNode::Unshared &newRoot) noexcept override {
    // A native resize lays out clones of the children the engine retains. When it commits those
    // older children again, Yoga can consider the root clean because their styles did not change.
    // Lay out the replacement children under the current constraints before mounting them.
    if (newRoot->getIsLayoutClean() && newRoot->getChildren() != oldRoot->getChildren()) {
      newRoot->dirtyLayout();
    }
    return newRoot;
  }
};

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
  auto desktopToolbox = toolbox;
  desktopToolbox.commitHooks.push_back(std::make_shared<RetainedLayout>());
  auto scheduler = std::make_unique<Scheduler>(desktopToolbox, gDriver.get(), delegate);
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
