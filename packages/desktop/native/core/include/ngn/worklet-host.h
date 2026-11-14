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
#include <string>

namespace facebook::react {
class Scheduler;
}

namespace ngn {

struct WorkletHost {
  // The backend's UI thread, the one its views and its display link belong to: the worklets' UI
  // runtime runs there.
  std::function<void(std::function<void()> task)> runOnUiThread;
  std::function<bool()> isUiThread;
  // Now in milliseconds, on the clock the frames are stamped with.
  std::function<double()> now;
  // The display frames, which the backend drives while they are wanted.
  AnimationFrames frames;
  // The running ReactHost's scheduler (its UIManager), set by the Runtime. Any thread.
  std::function<void(std::function<void(facebook::react::Scheduler &)>)> runOnScheduler;
  // React Native's fast path for props that need no layout (IMountingManager's
  // synchronouslyUpdateViewOnUIThread). UI thread.
  std::function<void(facebook::react::Tag tag, const folly::dynamic &props)> synchronouslyUpdateView;
  // The props a view is mounted with now, or null. UI thread.
  std::function<facebook::react::Props::Shared(facebook::react::Tag tag)> readMountedProps;

  // Set by Reanimated's glue while its module lives: an event for the worklets registered on a
  // view, as React Native iOS's RCTEventDispatcher hands RNGestureHandler's events to Reanimated.
  // UI thread.
  std::function<void(const std::string &name, facebook::react::Tag viewTag, const folly::dynamic &payload)>
      reanimatedEvent;
  // Set by the gesture handler's module: a worklet's GestureStateManager moving a handler's state
  // (begin, activate, fail, end), as Reanimated's setGestureState asks RNGestureHandlerModule.
  // UI thread.
  std::function<void(int handlerTag, int state)> setGestureState;
};

WorkletHost &workletHost();

} // namespace ngn
