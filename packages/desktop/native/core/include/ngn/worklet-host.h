// What react-native-worklets, Reanimated and the gesture handler's glue take from the host, which
// React Native iOS gives their modules through RCTBridge, RCTSurfacePresenter and the main queue.
// The runtime and the backend fill it in at start-up; the glue (core/src/libraries/) reads it when
// JavaScript first asks for the modules. A host built without the libraries never reads it.
#pragma once

#include "ngn/animation-frames.h"

#include <folly/dynamic.h>
#include <react/renderer/core/Props.h>
#include <react/renderer/core/ReactPrimitives.h>

#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <utility>

namespace facebook::react {
class Scheduler;
}

namespace ngn {

// A callback one thread sets or clears while another calls it: a reload clears the glue's on its
// own thread while the UI thread calls them. A call holds the whole callback it read, so clearing
// during it neither tears it nor frees its closure.
template <typename Signature>
class SharedCallback {
 public:
  using Function = std::function<Signature>;

  void set(Function function) {
    auto next = function ? std::make_shared<const Function>(std::move(function)) : nullptr;
    std::lock_guard lock(mutex_);
    // The old callback is released after the lock, in case its closure's destructor sets this.
    std::swap(function_, next);
  }
  std::shared_ptr<const Function> get() const {
    std::lock_guard lock(mutex_);
    return function_;
  }
  explicit operator bool() const {
    return get() != nullptr;
  }
  // Calls the callback if one is set, and says whether one was.
  template <typename... Args>
  bool call(Args &&...args) const {
    auto function = get();
    if (!function) {
      return false;
    }
    (*function)(std::forward<Args>(args)...);
    return true;
  }

 private:
  mutable std::mutex mutex_;
  std::shared_ptr<const Function> function_;
};

struct WorkletHost {
  // The backend's UI thread, the one its views and its display link belong to: the worklets' UI
  // runtime runs there.
  std::function<void(std::function<void()> task)> runOnUiThread;
  std::function<bool()> isUiThread;
  // Now in milliseconds, on the clock the frames are stamped with.
  std::function<double()> now;
  // The display frames, which the backend drives while they are wanted.
  AnimationFrames frames;
  // The running ReactHost's scheduler (its UIManager), set by the Runtime and cleared by a reload
  // on its own thread. Any thread.
  SharedCallback<void(std::function<void(facebook::react::Scheduler &)>)> runOnScheduler;
  // React Native's fast path for props that need no layout (IMountingManager's
  // synchronouslyUpdateViewOnUIThread). UI thread.
  std::function<void(facebook::react::Tag tag, const folly::dynamic &props)> synchronouslyUpdateView;
  // The props a view is mounted with now, or null. UI thread.
  std::function<facebook::react::Props::Shared(facebook::react::Tag tag)> readMountedProps;

  // Set by the worklets' glue while its module lives: the UI runtime's frame loop, parked while it
  // has nothing to do (worklets-idle-frames.js), runs a frame again. Called after work that ran on
  // the UI runtime outside a frame and may have changed a shared value. Called on the UI thread;
  // set on the JS thread and cleared as the module goes, on the reload's thread.
  SharedCallback<void()> wakeUiFrames;

  // Set by Reanimated's glue while its module lives: an event for the worklets registered on a
  // view, as React Native iOS's RCTEventDispatcher hands RNGestureHandler's events to Reanimated.
  // Called on the UI thread; set and cleared as wakeUiFrames is.
  SharedCallback<void(const std::string &name, facebook::react::Tag viewTag, const folly::dynamic &payload)> reanimatedEvent;
  // Set by the gesture handler's module: a worklet's GestureStateManager moving a handler's state
  // (begin, activate, fail, end), as Reanimated's setGestureState asks RNGestureHandlerModule.
  // UI thread.
  std::function<void(int handlerTag, int state)> setGestureState;
};

WorkletHost &workletHost();

} // namespace ngn
