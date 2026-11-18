#include "ngn/host-views.h"

#include "ngn/worklet-host.h"

namespace ngn {

HostViews makeHostViews(
    std::shared_ptr<MountingBackend> backend, std::shared_ptr<DesktopPropsSink> desktopProps, Gestures::Schedule schedule) {
  HostViews views;
  views.mounting = std::make_shared<MountingManager>(std::move(backend), std::move(desktopProps));
  views.input = std::make_unique<InputDispatcher>(views.mounting->tree());
  views.gestures = std::make_shared<Gestures>(views.mounting->tree(), std::move(schedule));
  views.input->setGestures(views.gestures.get());
  // A worklet gesture's events go to Reanimated's handlers on the UI runtime, and a worklet's
  // state manager comes back to the recognisers, while Reanimated is running.
  views.gestures->onWorkletEvent = [](const std::string &name, Tag view, const folly::dynamic &body) {
    workletHost().reanimatedEvent.call(name, view, body);
  };
  workletHost().setGestureState = [gestures = views.gestures](int handlerTag, int state) {
    gestures->setState(handlerTag, state);
  };
  return views;
}

} // namespace ngn
