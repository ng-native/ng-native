// React Native's layout animations on the desktop host: LayoutAnimation, and the engine's CSS
// transitions of a size or a place, which it commits where they end and asks native to move the
// view there. ReactCxxPlatform's ReactHost makes its Scheduler with no animation delegate, so
// configureNextLayoutAnimation did nothing and such a transition jumped to its end. The build
// patches ReactHost to make its Scheduler here (cmake/react-native.cmake), with React Native's
// LayoutAnimationDriver, as React Native iOS's RCTScheduler does.
#pragma once

#include <react/renderer/scheduler/Scheduler.h>

#include <functional>
#include <memory>

namespace ngn {

std::unique_ptr<facebook::react::Scheduler> makeScheduler(
    const facebook::react::SchedulerToolbox &toolbox,
    facebook::react::SchedulerDelegate *delegate);

// Called, on any thread, as layout animations start running and once all of them are done. While
// they run, the host calls Runtime::animationTick each frame.
void onLayoutAnimationsRunning(std::function<void(bool running)> handler);

} // namespace ngn
