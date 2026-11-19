// The view side every desktop host builds over its backend: the mounting manager, the input
// dispatcher over its view tree, and react-native-gesture-handler's recognisers, which the
// dispatcher feeds and Reanimated's worklet gestures reach through the worklet host both ways.
// The backend adds what only its toolkit has: the views, the timers and the UI thread.
#pragma once

#include "ngn/gestures.h"
#include "ngn/input-dispatcher.h"
#include "ngn/mounting-manager.h"

#include <memory>

namespace ngn {

struct HostViews {
  std::shared_ptr<MountingManager> mounting;
  std::unique_ptr<InputDispatcher> input;
  std::shared_ptr<Gestures> gestures;
};

// `schedule` runs the recognisers' timers on the UI thread.
HostViews makeHostViews(
    std::shared_ptr<MountingBackend> backend, std::shared_ptr<DesktopPropsSink> desktopProps, Gestures::Schedule schedule);

} // namespace ngn
