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
  draggingOut_ = false;
  press_ = Press{input.container, chain.back(), input.clickCount, input.point};
  sendTouch(TouchPhase::Start, input);
}

void InputDispatcher::pointerMove(const PointerInput &input) {
  auto container = containers_.find(input.container);
  if (container == containers_.end()) {
    return;
  }
  if (draggingOut_) {
    return;
  }
  updateHover(container->second, tree_.hitTest(container->second.root, input.point), input);
  if (press_ && !startDragOut(input)) {
    sendTouch(TouchPhase::Move, input);
  }
}

bool InputDispatcher::startDragOut(const PointerInput &input) {
  if (input.container != press_->container) {
    return false;
  }
  float dx = input.point.x - press_->start.x;
  float dy = input.point.y - press_->start.y;
  if (dx * dx + dy * dy < kDragThreshold * kDragThreshold) {
    return false;
  }
  auto container = containers_.find(press_->container);
  if (container == containers_.end()) {
    return false;
  }
  auto chain = tree_.chain(press_->target, container->second.root);
  for (auto it = chain.rbegin(); it != chain.rend(); ++it) {
    const auto *node = tree_.find(*it);
    if (node == nullptr || !node->view.props) {
      continue;
    }
    auto item = dragItemOf(desktopProps(*node->view.props).dragItem);
    if (!item) {
      continue;
    }
    sendTouch(TouchPhase::Cancel, input);
    press_.reset();
    draggingOut_ = true;
    if (onDragOut) {
      onDragOut(*it, input, *item);
    }
    return true;
  }
  return false;
}

void InputDispatcher::pointerUp(const PointerInput &input) {
  draggingOut_ = false;
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

namespace {

int hexValue(char c) {
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  if (c >= 'a' && c <= 'f') {
    return c - 'a' + 10;
  }
  if (c >= 'A' && c <= 'F') {
    return c - 'A' + 10;
  }
  return -1;
}

std::string percentDecoded(std::string_view text) {
  std::string out;
  for (size_t i = 0; i < text.size(); ++i) {
    int high = 0;
    int low = 0;
    if (text[i] == '%' && i + 2 < text.size() && (high = hexValue(text[i + 1])) >= 0 &&
        (low = hexValue(text[i + 2])) >= 0) {
      out.push_back(static_cast<char>(high * 16 + low));
      i += 2;
    } else {
      out.push_back(text[i]);
    }
  }
  return out;
}

} // namespace

std::optional<DragOutItem> dragItemOf(const folly::dynamic &prop) {
  if (!prop.isObject()) {
    return std::nullopt;
  }
  DragOutItem item;
  if (auto files = prop.get_ptr("files"); files != nullptr && files->isArray()) {
    for (const auto &file : *files) {
      if (file.isString() && file.asString().rfind("file:", 0) == 0) {
        item.files.push_back(file.asString());
      }
    }
  }
  if (auto text = prop.get_ptr("text"); text != nullptr && text->isString()) {
    item.text = text->asString();
  }
  if (auto url = prop.get_ptr("url"); url != nullptr && url->isString() && !url->asString().empty()) {
    item.url = url->asString();
  }
  if (item.files.empty() && !item.text && !item.url) {
    return std::nullopt;
  }
  return item;
}

DragItems dragItems(const std::vector<std::string> &urls, std::optional<std::string> text) {
  DragItems items;
  items.text = std::move(text);
  for (const auto &url : urls) {
    if (url.rfind("file:", 0) != 0) {
      items.urls.push_back(url);
      continue;
    }
    std::string_view path(url);
    while (path.size() > 1 && path.back() == '/') {
      path.remove_suffix(1);
    }
    auto slash = path.rfind('/');
    auto last = slash == std::string_view::npos ? path : path.substr(slash + 1);
    items.files.push_back({.uri = url, .name = percentDecoded(last)});
  }
  // The toolkit offers a dragged url as text too, and a file as its path.
  if (items.text) {
    for (const auto &url : urls) {
      bool path = url.rfind("file://", 0) == 0 && percentDecoded(std::string_view(url).substr(7)) == *items.text;
      if (url == *items.text || path) {
        items.text.reset();
        break;
      }
    }
  }
  return items;
}

folly::dynamic dropPayload(const DragItems &items) {
  auto files = folly::dynamic::array();
  for (const auto &file : items.files) {
    files.push_back(folly::dynamic::object("uri", file.uri)("name", file.name));
  }
  auto urls = folly::dynamic::array();
  for (const auto &url : items.urls) {
    urls.push_back(url);
  }
  return folly::dynamic::object("files", std::move(files))(
      "text", items.text ? folly::dynamic(*items.text) : folly::dynamic(nullptr))("urls", std::move(urls));
}

std::optional<Tag> InputDispatcher::dropTargetAt(const PointerInput &input) const {
  auto container = containers_.find(input.container);
  if (container == containers_.end()) {
    return std::nullopt;
  }
  auto chain = tree_.hitTest(container->second.root, input.point);
  for (auto it = chain.rbegin(); it != chain.rend(); ++it) {
    const auto *node = tree_.find(*it);
    if (node != nullptr && node->view.props && desktopProps(*node->view.props).fileDrop) {
      return *it;
    }
  }
  return std::nullopt;
}

void InputDispatcher::leaveDropTarget() {
  if (!dropTarget_) {
    return;
  }
  auto tag = dropTarget_->tag;
  dropTarget_.reset();
  if (const auto *node = tree_.find(tag)) {
    emitElementEvent(*node, "dropLeave", folly::dynamic::object());
  }
}

bool InputDispatcher::dragOver(const PointerInput &input, const DragItems &items) {
  auto target = dropTargetAt(input);
  if (dropTarget_ && target == dropTarget_->tag && dropTarget_->container == input.container) {
    return true;
  }
  leaveDropTarget();
  if (!target) {
    return false;
  }
  dropTarget_ = DropTarget{input.container, *target};
  if (const auto *node = tree_.find(*target)) {
    emitElementEvent(*node, "dropEnter", dropPayload(items));
  }
  return true;
}

void InputDispatcher::dragExit(ContainerId container) {
  if (dropTarget_ && dropTarget_->container == container) {
    leaveDropTarget();
  }
}

bool InputDispatcher::drop(const PointerInput &input, const DragItems &items) {
  auto target = dropTargetAt(input);
  if (dropTarget_ && dropTarget_->tag != target) {
    leaveDropTarget();
  }
  dropTarget_.reset();
  const auto *node = target ? tree_.find(*target) : nullptr;
  if (node == nullptr) {
    return false;
  }
  emitElementEvent(*node, "dropPerform", dropPayload(items));
  return true;
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
  if (phase != TouchPhase::End && phase != TouchPhase::Cancel) {
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
    case TouchPhase::Cancel:
      emitter->onTouchCancel(event);
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
