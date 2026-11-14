#include "ngn/input-dispatcher.h"

#include <react/renderer/components/view/TouchEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>

using namespace facebook::react;

namespace ngn {

namespace {

// Whether a view's props asked for this pointer event, directly or in the capture phase.
bool listens(const ViewTree::Node &node, ViewEvents::Offset offset, ViewEvents::Offset capture) {
  auto props = std::dynamic_pointer_cast<const ViewProps>(node.view.props);
  return props && (props->events[offset] || props->events[capture]);
}

std::shared_ptr<const TouchEventEmitter> touchEmitter(const ViewTree::Node &node) {
  return std::dynamic_pointer_cast<const TouchEventEmitter>(node.view.eventEmitter);
}

} // namespace

InputDispatcher::InputDispatcher(const ViewTree &tree) : tree_(tree) {}

void InputDispatcher::addContainer(ContainerId container, SurfaceId surfaceId, Tag rootTag) {
  containers_[container] = {surfaceId, rootTag};
}

void InputDispatcher::removeContainer(ContainerId container) {
  containers_.erase(container);
  if (press_ && press_->container == container) {
    press_.reset();
  }
}

const std::vector<Tag> &InputDispatcher::hovered(SurfaceId surfaceId) const {
  static const std::vector<Tag> none;
  auto it = hovered_.find(surfaceId);
  return it == hovered_.end() ? none : it->second;
}

void InputDispatcher::pointerDown(const PointerInput &input) {
  auto container = containers_.find(input.container);
  if (container == containers_.end()) {
    return;
  }
  auto chain = tree_.hitTest(container->second.root, input.point);
  updateHover(container->second, chain, input);
  if (chain.empty()) {
    return;
  }
  press_ = Press{input.container, chain.back()};
  sendTouch(TouchPhase::Start, input);
}

void InputDispatcher::pointerMove(const PointerInput &input) {
  auto container = containers_.find(input.container);
  if (container == containers_.end()) {
    return;
  }
  updateHover(container->second, tree_.hitTest(container->second.root, input.point), input);
  if (press_) {
    sendTouch(TouchPhase::Move, input);
  }
}

void InputDispatcher::pointerUp(const PointerInput &input) {
  if (press_) {
    sendTouch(TouchPhase::End, input);
    press_.reset();
  }
}

void InputDispatcher::pointerLeave(SurfaceId surfaceId, const PointerInput &input) {
  updateHover({surfaceId, surfaceId}, {}, input);
}

void InputDispatcher::updateHover(const Container &container, std::vector<Tag> chain, const PointerInput &input) {
  auto &before = hovered_[container.surfaceId];
  size_t common = 0;
  while (common < before.size() && common < chain.size() && before[common] == chain[common]) {
    common++;
  }
  auto event = pointerEvent(input, pageOrigin(container));
  // Leave from the deepest outwards, then enter from the outermost inwards, as the DOM does.
  for (size_t i = before.size(); i-- > common;) {
    const auto *node = tree_.find(before[i]);
    if (node && listens(*node, ViewEvents::Offset::PointerLeave, ViewEvents::Offset::PointerLeaveCapture)) {
      emitPointerLeave(*node, event);
    }
  }
  for (size_t i = common; i < chain.size(); i++) {
    const auto *node = tree_.find(chain[i]);
    if (node && listens(*node, ViewEvents::Offset::PointerEnter, ViewEvents::Offset::PointerEnterCapture)) {
      emitPointerEnter(*node, event);
    }
  }
  before = std::move(chain);
}

void InputDispatcher::sendTouch(TouchPhase phase, const PointerInput &input) {
  auto container = containers_.find(press_->container);
  const auto *target = tree_.find(press_->target);
  if (container == containers_.end() || target == nullptr) {
    return;
  }
  auto root = container->second.root;
  // Touches are reported in the surface's coordinates (page) and the target's (offset), whichever
  // container the press is in.
  auto rootOrigin = pageOrigin(container->second);
  auto targetOrigin = tree_.originIn(press_->target, root).value_or(Point{0, 0});
  Touch touch;
  touch.pagePoint = {input.point.x + rootOrigin.x, input.point.y + rootOrigin.y};
  touch.offsetPoint = {input.point.x - targetOrigin.x, input.point.y - targetOrigin.y};
  touch.screenPoint = input.screenPoint;
  touch.identifier = 0;
  touch.target = press_->target;
  touch.force = input.pressure;
  touch.timestamp = input.timestamp;
  touch.timeStamp = HighResTimeStamp::now();
  TouchEvent event;
  event.changedTouches.insert(touch);
  if (phase != TouchPhase::End) {
    event.touches.insert(touch);
    event.targetTouches.insert(touch);
  }
  emitTouch(phase, *target, event);
}

Point InputDispatcher::pageOrigin(const Container &container) const {
  return tree_.originIn(container.root, container.surfaceId).value_or(Point{0, 0});
}

PointerEvent InputDispatcher::pointerEvent(const PointerInput &input, Point pageOrigin) const {
  PointerEvent event{};
  event.pointerId = 1;
  event.pressure = input.pressure;
  event.pointerType = "mouse";
  event.clientPoint = {input.point.x + pageOrigin.x, input.point.y + pageOrigin.y};
  event.screenPoint = input.screenPoint;
  event.offsetPoint = input.point;
  event.width = 1;
  event.height = 1;
  event.detail = 0;
  event.buttons = input.buttons;
  event.isPrimary = true;
  event.button = -1;
  event.timeStamp = HighResTimeStamp::now();
  return event;
}

void InputDispatcher::emitTouch(TouchPhase phase, const ViewTree::Node &target, const TouchEvent &event) {
  auto emitter = touchEmitter(target);
  if (!emitter) {
    return;
  }
  switch (phase) {
    case TouchPhase::Start:
      emitter->onTouchStart(event);
      break;
    case TouchPhase::Move:
      emitter->onTouchMove(event);
      break;
    case TouchPhase::End:
      emitter->onTouchEnd(event);
      break;
  }
}

void InputDispatcher::emitPointerEnter(const ViewTree::Node &node, const PointerEvent &event) {
  if (auto emitter = touchEmitter(node)) {
    emitter->onPointerEnter(event);
  }
}

void InputDispatcher::emitPointerLeave(const ViewTree::Node &node, const PointerEvent &event) {
  if (auto emitter = touchEmitter(node)) {
    emitter->onPointerLeave(event);
  }
}

} // namespace ngn
