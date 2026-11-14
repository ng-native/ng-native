#include "ngn/tray-and-dock.h"

namespace ngn {

namespace {

std::string text(const folly::dynamic &object, const char *name) {
  auto it = object.find(name);
  return it != object.items().end() && it->second.isString() ? it->second.asString() : std::string{};
}

// A module that sends its host's events while it lives.
struct Listening : NativeModule {
  using NativeModule::NativeModule;
  std::shared_ptr<void> subscription;
};

} // namespace

std::vector<TrayIcon> parseTrayIcons(const folly::dynamic &icons) {
  std::vector<TrayIcon> out;
  if (!icons.isArray()) {
    return out;
  }
  for (const auto &icon : icons) {
    if (!icon.isObject()) {
      continue;
    }
    TrayIcon parsed{
        .id = text(icon, "id"),
        .title = text(icon, "title"),
        .sfSymbol = text(icon, "sfSymbol"),
        .image = text(icon, "image"),
        .tooltip = text(icon, "tooltip"),
    };
    if (auto menu = icon.find("menu"); menu != icon.items().end() && menu->second.isArray()) {
      parsed.menu = parseMenu(menu->second);
    }
    out.push_back(std::move(parsed));
  }
  return out;
}

std::shared_ptr<void> EventSource::listen(Listener listener, bool &reloaded) {
  std::lock_guard lock(mutex_);
  reloaded = next_ > 0;
  int id = next_++;
  listeners_[id] = std::move(listener);
  return std::shared_ptr<void>(nullptr, [this, id](void *) {
    std::lock_guard lock(mutex_);
    listeners_.erase(id);
  });
}

void EventSource::send(const folly::dynamic &event) {
  std::map<int, Listener> listeners;
  {
    std::lock_guard lock(mutex_);
    listeners = listeners_;
  }
  for (auto &[_, listener] : listeners) {
    listener(event);
  }
}

TrayHost::TrayHost(std::shared_ptr<TrayBackend> backend) : backend_(std::move(backend)) {}

void TrayHost::setIcons(const folly::dynamic &icons) {
  backend_->setIcons(parseTrayIcons(icons));
}

void TrayHost::press(const std::string &icon) {
  events_.send(folly::dynamic::object("type", "press")("icon", icon));
}

void TrayHost::menuSelect(const std::string &icon, const std::string &id) {
  events_.send(folly::dynamic::object("type", "menuSelect")("icon", icon)("id", id));
}

std::shared_ptr<void> TrayHost::attach(EventSource::Listener listener) {
  bool reloaded = false;
  auto subscription = events_.listen(std::move(listener), reloaded);
  if (reloaded) {
    backend_->setIcons({});
  }
  return subscription;
}

DockHost::DockHost(std::shared_ptr<DockBackend> backend) : backend_(std::move(backend)) {}

void DockHost::setMenu(const folly::dynamic &entries) {
  backend_->setMenu(entries.isArray() ? std::optional(parseMenu(entries)) : std::nullopt);
}

int DockHost::bounce(bool critical) {
  int id;
  {
    std::lock_guard lock(mutex_);
    id = nextBounce_++;
    bounces_.insert(id);
  }
  backend_->bounce(id, critical);
  return id;
}

void DockHost::cancelBounce(int id) {
  {
    std::lock_guard lock(mutex_);
    if (bounces_.erase(id) == 0) {
      return;
    }
  }
  backend_->cancelBounce(id);
}

void DockHost::menuSelect(const std::string &id) {
  events_.send(folly::dynamic::object("type", "menuSelect")("id", id));
}

std::shared_ptr<void> DockHost::attach(EventSource::Listener listener) {
  bool reloaded = false;
  auto subscription = events_.listen(std::move(listener), reloaded);
  if (reloaded) {
    backend_->setMenu(std::nullopt);
  }
  return subscription;
}

std::shared_ptr<NativeModule> makeTrayModule(std::shared_ptr<TrayHost> host) {
  struct Tray : Listening {
    explicit Tray(const std::shared_ptr<TrayHost> &host) : Listening("NgNativeTray") {
      async("setIcons", [host](const folly::dynamic &args, std::vector<JsCallback>) {
        host->setIcons(args.size() > 0 ? args[0] : nullptr);
      });
      listeners();
      subscription = host->attach([this](const folly::dynamic &event) { emit("ngNativeTray", event); });
    }
  };
  return std::make_shared<Tray>(host);
}

std::shared_ptr<NativeModule> makeDockModule(std::shared_ptr<DockHost> host) {
  struct Dock : Listening {
    explicit Dock(const std::shared_ptr<DockHost> &host) : Listening("NgNativeDock") {
      async("setMenu", [host](const folly::dynamic &args, std::vector<JsCallback>) {
        host->setMenu(args.size() > 0 ? args[0] : nullptr);
      });
      sync("bounce", [host](const folly::dynamic &args) {
        return folly::dynamic(host->bounce(args.size() > 0 && args[0].isBool() && args[0].asBool()));
      });
      async("cancelBounce", [host](const folly::dynamic &args, std::vector<JsCallback>) {
        if (args.size() > 0 && args[0].isNumber()) {
          host->cancelBounce(static_cast<int>(args[0].asInt()));
        }
      });
      listeners();
      subscription = host->attach([this](const folly::dynamic &event) { emit("ngNativeDock", event); });
    }
  };
  return std::make_shared<Dock>(host);
}

} // namespace ngn
