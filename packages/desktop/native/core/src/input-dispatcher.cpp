#include "ngn/input-dispatcher.h"

#include "ngn/app-menus.h"

#include <react/renderer/components/view/TouchEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>

using namespace facebook::react;

namespace ngn {

namespace {

std::shared_ptr<const TouchEventEmitter> touchEmitter(const ViewTree::Node &node) {
  return std::dynamic_pointer_cast<const TouchEventEmitter>(node.view.eventEmitter);
}

} // namespace

Cursor cursorFor(const ViewTree &tree, const std::vector<Tag> &chain) {
  for (size_t i = chain.size(); i-- > 0;) {
    const auto *node = tree.find(chain[i]);
    if (node == nullptr || !node->view.props) {
      continue;
    }
    if (auto cursor = desktopProps(*node->view.props).cursor) {
      return *cursor;
    }
    auto props = std::dynamic_pointer_cast<const ViewProps>(node->view.props);
    if (props && props->cursor != Cursor::Auto) {
      return props->cursor;
    }
    if (std::string_view(node->view.componentName) == "TextInput") {
      return Cursor::Text;
    }
  }
  return Cursor::Auto;
}

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
  press_ = Press{input.container, chain.back(), input.clickCount};
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
  if (!press_) {
    return;
  }
  sendTouch(TouchPhase::End, input);
  auto press = *press_;
  press_.reset();
  // The DOM's dblclick comes as the second click of a run ends, on the view it pressed.
  auto container = containers_.find(press.container);
  if (press.clickCount == 2 && container != containers_.end() && tree_.find(press.target) != nullptr) {
    auto chain = tree_.chain(press.target, container->second.root);
    sendElementEvent(
        container->second,
        chain,
        &DesktopProps::onDoubleClick,
        "doubleClick",
        locationPayload(container->second, press.target, input.point));
  }
}

void InputDispatcher::pointerLeave(SurfaceId surfaceId, const PointerInput &input) {
  updateHover({surfaceId, surfaceId}, {}, input);
  if (pointerSurface_ == surfaceId) {
    pointerSurface_.reset();
    setCursor(Cursor::Auto);
  }
}

bool InputDispatcher::contextMenu(const PointerInput &input) {
  auto container = containers_.find(input.container);
  if (container == containers_.end()) {
    return false;
  }
  auto chain = tree_.hitTest(container->second.root, input.point);
  if (chain.empty()) {
    return false;
  }
  return sendElementEvent(
      container->second,
      chain,
      &DesktopProps::onContextMenu,
      "contextMenu",
      locationPayload(container->second, chain.back(), input.point));
}

std::optional<InputDispatcher::ContextMenuTarget> InputDispatcher::contextMenuAt(const PointerInput &input) const {
  auto container = containers_.find(input.container);
  if (container == containers_.end()) {
    return std::nullopt;
  }
  auto chain = tree_.hitTest(container->second.root, input.point);
  for (auto it = chain.rbegin(); it != chain.rend(); ++it) {
    const auto *node = tree_.find(*it);
    if (node == nullptr || !node->view.props) {
      continue;
    }
    auto menu = parseMenu(desktopProps(*node->view.props).contextMenu);
    if (!menu.empty()) {
      return ContextMenuTarget{.tag = *it, .items = std::move(menu)};
    }
  }
  return std::nullopt;
}

void InputDispatcher::contextMenuSelect(Tag tag, const std::string &id) {
  if (const auto *node = tree_.find(tag)) {
    emitElementEvent(*node, "contextMenuSelect", folly::dynamic::object("id", id));
  }
}

bool InputDispatcher::wheel(const PointerInput &input, const WheelDelta &delta) {
  auto container = containers_.find(input.container);
  if (container == containers_.end()) {
    return false;
  }
  auto chain = tree_.hitTest(container->second.root, input.point);
  return sendElementEvent(
      container->second,
      chain,
      &DesktopProps::onWheel,
      "wheel",
      folly::dynamic::object("deltaX", delta.x)("deltaY", delta.y)("deltaZ", delta.z)("deltaMode", delta.mode));
}

void InputDispatcher::didMount(SurfaceId surfaceId) {
  if (pointerSurface_ == surfaceId) {
    setCursor(cursorFor(tree_, hovered(surfaceId)));
  }
}

bool InputDispatcher::sendElementEvent(
    const Container &container,
    const std::vector<Tag> &chain,
    bool DesktopProps::*optIn,
    const std::string &name,
    folly::dynamic payload) {
  bool asked = false;
  for (auto tag : chain) {
    const auto *node = tree_.find(tag);
    if (node && node->view.props && desktopProps(*node->view.props).*optIn) {
      asked = true;
      break;
    }
  }
  const auto *target = chain.empty() ? nullptr : tree_.find(chain.back());
  if (!asked || target == nullptr) {
    return false;
  }
  emitElementEvent(*target, name, std::move(payload));
  return true;
}

folly::dynamic InputDispatcher::locationPayload(const Container &container, Tag target, Point point) const {
  auto page = pageOrigin(container);
  auto origin = tree_.originIn(target, container.root).value_or(Point{0, 0});
  return folly::dynamic::object("pageX", point.x + page.x)("pageY", point.y + page.y)("locationX", point.x - origin.x)(
      "locationY", point.y - origin.y);
}

void InputDispatcher::setCursor(Cursor cursor) {
  if (cursor_ == cursor) {
    return;
  }
  cursor_ = cursor;
  if (onCursor) {
    onCursor(cursor);
  }
}

void InputDispatcher::updateHover(const Container &container, std::vector<Tag> chain, const PointerInput &input) {
  auto &before = hovered_[container.surfaceId];
  auto event = pointerEvent(input, pageOrigin(container));
  // React Native's PointerEventsProcessor tracks hover itself from the moves it is sent, as React
  // Native iOS sends them: it sends over, out, enter and leave to the views that listen, and the
  // move itself only when a view in the path does. A platform leave means the pointer left the
  // surface. Sending enter or leave here as well would deliver each twice.
  if (!chain.empty()) {
    if (const auto *node = tree_.find(chain.back())) {
      auto origin = tree_.originIn(chain.back(), container.root).value_or(Point{0, 0});
      event.offsetPoint = {input.point.x - origin.x, input.point.y - origin.y};
      emitPointer(PointerKind::Move, *node, event);
    }
    pointerSurface_ = container.surfaceId;
  } else if (!before.empty()) {
    // The processor needs a view of the surface to name; the one the pointer was last over.
    for (size_t i = before.size(); i-- > 0;) {
      if (const auto *node = tree_.find(before[i])) {
        emitPointer(PointerKind::Leave, *node, event);
        break;
      }
    }
  }
  setCursor(cursorFor(tree_, chain));
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

void InputDispatcher::emitPointer(PointerKind kind, const ViewTree::Node &node, const PointerEvent &event) {
  auto emitter = touchEmitter(node);
  if (!emitter) {
    return;
  }
  switch (kind) {
    case PointerKind::Enter:
      emitter->onPointerEnter(event);
      break;
    case PointerKind::Leave:
      emitter->onPointerLeave(event);
      break;
    case PointerKind::Move:
      emitter->onPointerMove(event);
      break;
    case PointerKind::Over:
      emitter->onPointerOver(event);
      break;
    case PointerKind::Out:
      emitter->onPointerOut(event);
      break;
  }
}

void InputDispatcher::emitElementEvent(const ViewTree::Node &node, const std::string &name, folly::dynamic payload) {
  if (node.view.eventEmitter) {
    auto category = name == "wheel" ? RawEvent::Category::Continuous : RawEvent::Category::Discrete;
    node.view.eventEmitter->dispatchEvent(name, std::move(payload), category);
  }
}

} // namespace ngn
