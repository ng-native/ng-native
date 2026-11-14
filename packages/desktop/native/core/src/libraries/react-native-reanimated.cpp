// Reanimated's native part on the desktop host, in place of its iOS ReanimatedModule.mm,
// NativeProxy.mm, PlatformDepMethodsHolderImpl.mm and REANodesManager.mm: the ReanimatedModule
// TurboModule and the platform methods its shared C++ calls. Frames come from the host's animation
// frames (ngn/worklet-host.h), and after each frame's callbacks the queued updates are performed,
// which commits them to the shadow tree from the UI thread as Reanimated does on iOS. Compiled into
// the host only with the library (cmake/libraries/react-native-reanimated.cmake).
#include "ngn/library-glue.h"
#include "ngn/worklet-host.h"

#include <ReactCommon/TurboModule.h>
#include <jsi/JSIDynamic.h>
#include <react/renderer/scheduler/Scheduler.h>
#include <react/renderer/uimanager/UIManager.h>
#include <reanimated/Compat/WorkletsApi.h>
#include <reanimated/NativeModules/ReanimatedModuleProxy.h>
#include <reanimated/RuntimeDecorators/RNRuntimeDecorator.h>
#include <reanimated/Tools/PlatformDepMethodsHolder.h>

#include <mutex>
#include <vector>

using namespace facebook;
using namespace facebook::react;

namespace ngn {

namespace {

// REANodesManager's frame loop: the callbacks Reanimated asks a frame for, run together, then its
// queued updates performed. UI thread, but for requests.
class FrameLoop : public std::enable_shared_from_this<FrameLoop> {
 public:
  void request(std::function<void(double)> onRender) {
    {
      std::lock_guard lock(mutex_);
      waiting_.push_back(std::move(onRender));
      if (scheduled_) {
        return;
      }
      scheduled_ = true;
    }
    workletHost().frames.request([weak = weak_from_this()](double ms) {
      if (auto self = weak.lock()) {
        self->frame(ms);
      }
    });
  }

  // maybeFlushUIUpdatesQueue: with no frame coming, the updates are performed now.
  void flushUnlessFrameComing() {
    {
      std::lock_guard lock(mutex_);
      if (scheduled_) {
        return;
      }
    }
    perform();
  }

  void perform() {
    if (auto proxy = proxy_.lock()) {
      proxy->performOperations();
    }
  }

  std::weak_ptr<reanimated::ReanimatedModuleProxy> proxy_;

 private:
  void frame(double ms) {
    std::vector<std::function<void(double)>> running;
    {
      std::lock_guard lock(mutex_);
      running.swap(waiting_);
      scheduled_ = false;
    }
    for (auto &onRender : running) {
      onRender(ms);
    }
    perform();
  }

  std::mutex mutex_;
  std::vector<std::function<void(double)>> waiting_;
  bool scheduled_{false};
};

reanimated::PlatformDepMethodsHolder platformMethods(const std::shared_ptr<FrameLoop> &loop) {
  return reanimated::PlatformDepMethodsHolder{
      .requestRender = [loop](std::function<void(const double)> onRender) { loop->request(std::move(onRender)); },
      // react-native-screens' snapshots, which the desktop's screens do not take.
      .forceScreenSnapshotFunction = [](Tag) { return false; },
      .readMountedViewPropsFunction = [](Tag tag) -> Props::Shared {
        auto read = workletHost().readMountedProps;
        return read ? read(tag) : nullptr;
      },
      .synchronouslyUpdateUIPropsFunction =
          [](const int tag, const folly::dynamic &props) {
            if (auto update = workletHost().synchronouslyUpdateView) {
              update(tag, props);
            }
          },
      .getAnimationTimestamp = [] { return workletHost().now(); },
      // useAnimatedSensor: the Mac has no motion sensors to read.
      .registerSensor = [](int, int, int, std::function<void(double[], int)>) { return -1; },
      .unregisterSensor = [](int) {},
      .setGestureStateFunction =
          [](int handlerTag, int state) {
            if (auto set = workletHost().setGestureState) {
              set(handlerTag, state);
            }
          },
      // useAnimatedKeyboard: no software keyboard on a Mac.
      .subscribeForKeyboardEvents = [](std::function<void(int, int)>, bool, bool) { return -1; },
      .unsubscribeFromKeyboardEvents = [](int) {},
      .maybeFlushUIUpdatesQueueFunction = [loop] { loop->flushUnlessFrameComing(); },
      // CSS pseudo-class styles (:hover, :active) are the engine's own on the desktop.
      .attachPseudoSelector = [](Tag, reanimated::PseudoSelector, std::function<void(bool)>) {},
      .detachPseudoSelector = [](Tag, reanimated::PseudoSelector) {},
      .platformTransitionBackend = nullptr,
      .platformAnimationFactory = nullptr,
  };
}

class ReanimatedModule final : public TurboModule {
 public:
  explicit ReanimatedModule(const std::shared_ptr<CallInvoker> &jsInvoker)
      : TurboModule("ReanimatedModule", jsInvoker), jsInvoker_(jsInvoker) {
    methodMap_["installTurboModule"] = MethodMetadata{0, &ReanimatedModule::installTurboModule};
  }

  ~ReanimatedModule() override {
    auto &host = workletHost();
    host.reanimatedEvent = nullptr;
    if (listener_ && host.runOnScheduler) {
      host.runOnScheduler([listener = listener_](Scheduler &scheduler) { scheduler.removeEventListener(listener); });
    }
    proxy_.reset();
  }

 private:
  static jsi::Value installTurboModule(jsi::Runtime &rt, TurboModule &turboModule, const jsi::Value *, size_t) {
    auto &self = static_cast<ReanimatedModule &>(turboModule);
    auto &host = workletHost();
    if (self.proxy_) {
      return jsi::Value(true);
    }
    std::shared_ptr<UIManager> uiManager;
    if (host.runOnScheduler) {
      host.runOnScheduler([&](Scheduler &scheduler) { uiManager = scheduler.getUIManager(); });
    }
    if (!uiManager) {
      return jsi::Value(false);
    }
    auto global = rt.global();
    auto uiWorkletRuntime =
        worklets::getWorkletRuntimeFromHolder(rt, global.getPropertyAsObject(rt, "__UI_WORKLET_RUNTIME_HOLDER"));
    auto uiScheduler = worklets::getUISchedulerFromHolder(rt, global.getPropertyAsObject(rt, "__UI_SCHEDULER_HOLDER"));

    self.loop_ = std::make_shared<FrameLoop>();
    auto methods = platformMethods(self.loop_);
    auto proxy = std::make_shared<reanimated::ReanimatedModuleProxy>(
        uiWorkletRuntime, uiScheduler, rt, self.jsInvoker_, methods, false);
    proxy->init(methods);
    self.loop_->proxy_ = proxy;
    auto &uiRuntime = worklets::getJSIRuntimeFromWorkletRuntime(uiWorkletRuntime);
    reanimated::RNRuntimeDecorator::decorate(rt, uiRuntime, proxy);
    proxy->initializeFabric(uiManager);
    self.proxy_ = proxy;

    // Fabric's events reach the worklets that listen for them (useEvent, scroll handlers) on the
    // UI thread, before JavaScript: the events the desktop dispatches from the UI thread.
    std::weak_ptr<reanimated::ReanimatedModuleProxy> weak = proxy;
    self.listener_ = std::make_shared<const EventListener>([weak](const RawEvent &event) {
      auto isUi = workletHost().isUiThread;
      if (!isUi || !isUi()) {
        return false;
      }
      if (auto proxy = weak.lock()) {
        return proxy->handleRawEvent(event, workletHost().now());
      }
      return false;
    });
    host.runOnScheduler([listener = self.listener_](Scheduler &scheduler) { scheduler.addEventListener(listener); });

    // The gesture handler's events for a worklet gesture, as REANodesManager's dispatchEvent takes
    // RNGestureHandler's: handled on the UI runtime, then the updates they queued performed.
    std::weak_ptr<FrameLoop> loop = self.loop_;
    host.reanimatedEvent = [weak, loop, uiWorkletRuntime](const std::string &name, Tag tag, const folly::dynamic &payload) {
      auto proxy = weak.lock();
      if (!proxy) {
        return;
      }
      auto &uiRuntime = worklets::getJSIRuntimeFromWorkletRuntime(uiWorkletRuntime);
      proxy->handleEvent(name, tag, jsi::valueFromDynamic(uiRuntime, payload), workletHost().now());
      // The handler may have moved a shared value, whose mappers run on the next frame.
      if (auto wake = workletHost().wakeUiFrames) {
        wake();
      }
      if (auto frames = loop.lock()) {
        frames->perform();
      }
    };
    return jsi::Value(true);
  }

  std::shared_ptr<CallInvoker> jsInvoker_;
  std::shared_ptr<FrameLoop> loop_;
  std::shared_ptr<reanimated::ReanimatedModuleProxy> proxy_;
  std::shared_ptr<const EventListener> listener_;
};

} // namespace

void installGlue_rnreanimated() {
  libraryGlue().modules["ReanimatedModule"] = [](const std::shared_ptr<CallInvoker> &jsInvoker) {
    return std::make_shared<ReanimatedModule>(jsInvoker);
  };
}

} // namespace ngn
