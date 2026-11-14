#include "ngn/app-windows.h"

#include <algorithm>

namespace ngn {

namespace {

constexpr const char *kEvent = "ngNativeWindows";

std::optional<double> number(const folly::dynamic &object, const char *name) {
  auto it = object.find(name);
  if (it == object.items().end() || !it->second.isNumber()) {
    return std::nullopt;
  }
  return it->second.asDouble();
}

std::string frameKey(const std::string &key) {
  return "NgNativeWindowFrame " + key;
}

std::optional<WindowFrame> savedFrame(const std::optional<folly::dynamic> &value) {
  if (!value || !value->isObject()) {
    return std::nullopt;
  }
  auto x = number(*value, "x");
  auto y = number(*value, "y");
  auto width = number(*value, "width");
  auto height = number(*value, "height");
  if (!x || !y || !width || !height || *width <= 0 || *height <= 0) {
    return std::nullopt;
  }
  return WindowFrame{.x = *x, .y = *y, .width = *width, .height = *height};
}

double clamp(double value, std::optional<double> min, std::optional<double> max) {
  if (max) {
    value = std::min(value, *max);
  }
  if (min) {
    value = std::max(value, *min);
  }
  return value;
}

} // namespace

WindowRequest windowRequest(const folly::dynamic &request) {
  WindowRequest out;
  if (!request.isObject()) {
    return out;
  }
  if (auto key = request.find("key"); key != request.items().end() && key->second.isString()) {
    out.key = key->second.asString();
  }
  if (auto title = request.find("title"); title != request.items().end() && title->second.isString()) {
    out.title = title->second.asString();
  }
  out.width = number(request, "width");
  out.height = number(request, "height");
  out.minWidth = number(request, "minWidth");
  out.minHeight = number(request, "minHeight");
  out.maxWidth = number(request, "maxWidth");
  out.maxHeight = number(request, "maxHeight");
  if (auto resizable = request.find("resizable"); resizable != request.items().end() && resizable->second.isBool()) {
    out.resizable = resizable->second.asBool();
  }
  if (auto bar = request.find("titleBar"); bar != request.items().end() && bar->second.isString()) {
    out.titleBar = bar->second.asString() == "transparent" ? TitleBar::Transparent
        : bar->second.asString() == "hidden"               ? TitleBar::Hidden
                                                           : TitleBar::Default;
  }
  if (auto full = request.find("fullScreen"); full != request.items().end() && full->second.isBool()) {
    out.fullScreen = full->second.asBool();
  }
  return out;
}

WindowHost::WindowHost(std::shared_ptr<WindowBackend> backend, std::shared_ptr<System> system)
    : backend_(std::move(backend)), system_(std::move(system)) {}

WindowPlacement WindowHost::placement(const WindowRequest &request) {
  double width = request.width.value_or(kDefaultWindowWidth);
  double height = request.height.value_or(kDefaultWindowHeight);
  WindowPlacement out{.frame = {.width = width, .height = height}};
  if (request.key) {
    if (auto saved = savedFrame(system_->preference(frameKey(*request.key)))) {
      out.frame = *saved;
      out.restored = true;
      if (!request.resizable) {
        out.frame.width = width;
        out.frame.height = height;
      }
    }
  }
  out.frame.width = clamp(out.frame.width, request.minWidth, request.maxWidth);
  out.frame.height = clamp(out.frame.height, request.minHeight, request.maxHeight);
  return out;
}

void WindowHost::open(const WindowRequest &request, std::function<void(SurfaceId)> done) {
  std::optional<SurfaceId> kept;
  SurfaceId surface;
  {
    std::lock_guard lock(mutex_);
    // A window a reload kept goes back to the app that asks for its key again.
    for (auto &[id, window] : windows_) {
      if (request.key && window.kept && window.key == request.key) {
        window.kept = false;
        kept = id;
        break;
      }
    }
    surface = kept.value_or(next_);
    if (!kept) {
      next_ += 10;
      windows_[surface] = {.key = request.key};
    }
  }
  if (kept) {
    backend_->setWindowTitle(surface, request.title);
    done(surface);
    return;
  }
  backend_->openWindow(surface, request, placement(request), [done, surface] { done(surface); });
}

void WindowHost::close(SurfaceId surface) {
  {
    std::lock_guard lock(mutex_);
    if (windows_.erase(surface) == 0) {
      return;
    }
    if (focused_ == surface) {
      focused_.reset();
    }
  }
  backend_->closeWindow(surface);
}

void WindowHost::focus(SurfaceId surface) {
  {
    std::lock_guard lock(mutex_);
    if (!windows_.contains(surface)) {
      return;
    }
  }
  backend_->focusWindow(surface);
}

void WindowHost::setTitle(SurfaceId surface, const std::string &title) {
  {
    std::lock_guard lock(mutex_);
    if (!windows_.contains(surface)) {
      return;
    }
  }
  backend_->setWindowTitle(surface, title);
}

void WindowHost::quit() {
  backend_->beginQuit();
}

void WindowHost::answerQuit(bool proceed) {
  bool asked;
  {
    std::lock_guard lock(mutex_);
    asked = quitAsked_;
    quitAsked_ = false;
    if (!asked && proceed) {
      quitAgreed_ = true;
    }
  }
  if (asked) {
    backend_->replyToQuit(proceed);
  } else if (proceed) {
    backend_->beginQuit();
  }
}

bool WindowHost::closeRequested(SurfaceId surface) {
  {
    std::lock_guard lock(mutex_);
    if (listeners_.empty()) {
      windows_.erase(surface);
      return true;
    }
    if (!windows_.contains(surface)) {
      return true;
    }
  }
  send(folly::dynamic::object("type", "closeRequest")("surface", surface));
  return false;
}

QuitReply WindowHost::quitRequested() {
  {
    std::lock_guard lock(mutex_);
    if (quitAgreed_ || listeners_.empty()) {
      return QuitReply::Now;
    }
    if (quitAsked_) {
      return QuitReply::Later;
    }
    quitAsked_ = true;
  }
  send(folly::dynamic::object("type", "quitRequest"));
  return QuitReply::Later;
}

void WindowHost::focused(std::optional<SurfaceId> surface) {
  {
    std::lock_guard lock(mutex_);
    if (surface && !windows_.contains(*surface)) {
      surface.reset();
    }
    if (focused_ == surface) {
      return;
    }
    focused_ = surface;
  }
  send(folly::dynamic::object("type", "focus")("surface", surface ? folly::dynamic(*surface) : folly::dynamic(nullptr)));
}

void WindowHost::resized(SurfaceId surface, const WindowFrame &frame, double scale) {
  {
    std::lock_guard lock(mutex_);
    if (!windows_.contains(surface)) {
      return;
    }
  }
  autosave(surface, frame);
  send(folly::dynamic::object("type", "resize")("surface", surface)("width", frame.width)("height", frame.height)(
      "scale", scale));
}

void WindowHost::moved(SurfaceId surface, const WindowFrame &frame) {
  autosave(surface, frame);
}

void WindowHost::autosave(SurfaceId surface, const WindowFrame &frame) {
  std::optional<std::string> key;
  {
    std::lock_guard lock(mutex_);
    if (auto it = windows_.find(surface); it != windows_.end()) {
      key = it->second.key;
    }
  }
  if (key) {
    system_->setPreference(
        frameKey(*key),
        folly::dynamic::object("x", frame.x)("y", frame.y)("width", frame.width)("height", frame.height));
  }
}

void WindowHost::reopen(bool hasVisibleWindows) {
  if (!hasVisibleWindows) {
    send(folly::dynamic::object("type", "reopen"));
  }
}

void WindowHost::reloading() {
  std::vector<SurfaceId> closing;
  {
    std::lock_guard lock(mutex_);
    for (auto it = windows_.begin(); it != windows_.end();) {
      if (it->second.key) {
        it->second.kept = true;
        ++it;
      } else {
        closing.push_back(it->first);
        it = windows_.erase(it);
      }
    }
    quitAsked_ = false;
    focused_.reset();
  }
  for (auto surface : closing) {
    backend_->closeWindow(surface);
  }
}

void WindowHost::dropUnclaimed() {
  std::vector<SurfaceId> closing;
  {
    std::lock_guard lock(mutex_);
    for (auto it = windows_.begin(); it != windows_.end();) {
      if (it->second.kept) {
        closing.push_back(it->first);
        it = windows_.erase(it);
      } else {
        ++it;
      }
    }
  }
  for (auto surface : closing) {
    backend_->closeWindow(surface);
  }
}

std::vector<SurfaceId> WindowHost::surfaces() const {
  std::lock_guard lock(mutex_);
  std::vector<SurfaceId> out;
  for (const auto &[id, _] : windows_) {
    out.push_back(id);
  }
  return out;
}

std::optional<SurfaceId> WindowHost::focusedSurface() const {
  std::lock_guard lock(mutex_);
  return focused_;
}

std::shared_ptr<void> WindowHost::attach(Listener listener) {
  bool reloaded;
  int id;
  {
    std::lock_guard lock(mutex_);
    reloaded = attached_;
    attached_ = true;
    id = nextListener_++;
    listeners_[id] = std::move(listener);
  }
  if (reloaded) {
    reloading();
    backend_->after(kClaimSeconds, [this] { dropUnclaimed(); });
  }
  return std::shared_ptr<void>(nullptr, [this, id](void *) {
    std::lock_guard lock(mutex_);
    listeners_.erase(id);
  });
}

void WindowHost::send(const folly::dynamic &event) {
  std::map<int, Listener> listeners;
  {
    std::lock_guard lock(mutex_);
    listeners = listeners_;
  }
  for (auto &[_, listener] : listeners) {
    listener(event);
  }
}

std::shared_ptr<NativeModule> makeWindowsModule(std::shared_ptr<WindowHost> host) {
  struct Windows : NativeModule {
    std::shared_ptr<void> subscription;
    explicit Windows(std::shared_ptr<WindowHost> host) : NativeModule("NgNativeWindows") {
      constants([] { return folly::dynamic::object("multipleWindows", true); });
      promise("open", [host](const folly::dynamic &args, JsPromise promise) {
        host->open(windowRequest(args.size() > 0 ? args[0] : nullptr), [promise](SurfaceId surface) {
          promise.resolve(surface);
        });
      });
      auto surfaceArg = [](const folly::dynamic &args) -> std::optional<SurfaceId> {
        if (args.size() > 0 && args[0].isNumber()) {
          return static_cast<SurfaceId>(args[0].asInt());
        }
        return std::nullopt;
      };
      async("close", [host, surfaceArg](const folly::dynamic &args, std::vector<JsCallback>) {
        if (auto surface = surfaceArg(args)) {
          host->close(*surface);
        }
      });
      async("focus", [host, surfaceArg](const folly::dynamic &args, std::vector<JsCallback>) {
        if (auto surface = surfaceArg(args)) {
          host->focus(*surface);
        }
      });
      async("setTitle", [host, surfaceArg](const folly::dynamic &args, std::vector<JsCallback>) {
        if (auto surface = surfaceArg(args); surface && args.size() > 1 && args[1].isString()) {
          host->setTitle(*surface, args[1].asString());
        }
      });
      async("quit", [host](const folly::dynamic &, std::vector<JsCallback>) { host->quit(); });
      async("answerQuit", [host](const folly::dynamic &args, std::vector<JsCallback>) {
        host->answerQuit(args.size() > 0 && args[0].isBool() && args[0].asBool());
      });
      listeners();
      subscription = host->attach([this](const folly::dynamic &event) { emit(kEvent, event); });
    }
  };
  return std::make_shared<Windows>(std::move(host));
}

} // namespace ngn
