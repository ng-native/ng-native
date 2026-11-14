#include "ngn/app-menus.h"

#include <algorithm>
#include <cctype>

namespace ngn {

namespace {

constexpr const char *kEvent = "ngNativeMenus";

std::string text(const folly::dynamic &object, const char *name) {
  auto it = object.find(name);
  return it != object.items().end() && it->second.isString() ? it->second.asString() : std::string{};
}

bool flag(const folly::dynamic &object, const char *name) {
  auto it = object.find(name);
  return it != object.items().end() && it->second.isBool() && it->second.asBool();
}

// The OS's command for a `menuRole`, or AppItem for one the OS has none for.
MenuCommand roleCommand(const std::string &role) {
  static const std::map<std::string, MenuCommand> commands{
      {"about", MenuCommand::About},
      {"hide", MenuCommand::Hide},
      {"hideOthers", MenuCommand::HideOthers},
      {"showAll", MenuCommand::ShowAll},
      {"quit", MenuCommand::Quit},
      {"undo", MenuCommand::Undo},
      {"redo", MenuCommand::Redo},
      {"cut", MenuCommand::Cut},
      {"copy", MenuCommand::Copy},
      {"paste", MenuCommand::Paste},
      {"selectAll", MenuCommand::SelectAll},
      {"find", MenuCommand::Find},
      {"toggleSidebar", MenuCommand::ToggleSidebar},
      {"toggleFullScreen", MenuCommand::ToggleFullScreen},
      {"back", MenuCommand::Back},
      {"forward", MenuCommand::Forward},
      {"minimize", MenuCommand::Minimize},
      {"zoom", MenuCommand::Zoom},
      {"bringAllToFront", MenuCommand::BringAllToFront},
      {"close", MenuCommand::CloseWindow},
      {"print", MenuCommand::Print},
  };
  auto it = commands.find(role);
  return it == commands.end() ? MenuCommand::AppItem : it->second;
}

std::string normalKey(std::string key) {
  if (key.size() == 1) {
    key[0] = static_cast<char>(std::tolower(static_cast<unsigned char>(key[0])));
  }
  return key;
}

MenuItem parseItem(const folly::dynamic &entry) {
  if (!entry.isObject() || flag(entry, "separator")) {
    return MenuItem{.separator = true};
  }
  MenuItem item{
      .title = text(entry, "label"),
      .id = text(entry, "id"),
      .disabled = flag(entry, "disabled"),
      .checked = flag(entry, "checked"),
      .destructive = flag(entry, "destructive"),
      .subtitle = text(entry, "subtitle"),
      .sfSymbol = text(entry, "sfSymbol"),
      .inlineItems = flag(entry, "inline"),
  };
  auto role = text(entry, "menuRole");
  if (role == "services") {
    // AppKit fills it.
    item.role = MenuRole::Services;
    return item;
  }
  item.command = role.empty() || flag(entry, "handled") ? MenuCommand::AppItem : roleCommand(role);
  if (auto shortcut = entry.find("shortcut"); shortcut != entry.items().end() && shortcut->second.isObject()) {
    auto chord = parseChord(shortcut->second);
    item.key = chord.key;
    item.modifiers = chord.modifiers;
  }
  if (auto items = entry.find("items"); items != entry.items().end()) {
    item.items = parseMenu(items->second);
  }
  return item;
}

MenuRole groupRole(const std::string &role) {
  return role == "app" ? MenuRole::App : role == "window" ? MenuRole::Window : role == "help" ? MenuRole::Help : MenuRole::None;
}

const char *directionName(NavigationDirection direction) {
  return direction == NavigationDirection::Back ? "back" : "forward";
}

// The keys a focused text input owns.
bool editingChord(const KeyChord &chord) {
  static const std::vector<std::string> keys{"z", "x", "c", "v", "a"};
  return chord.modifiers == Command && std::find(keys.begin(), keys.end(), chord.key) != keys.end();
}

} // namespace

KeyChord parseChord(const folly::dynamic &chord) {
  KeyChord out{.key = normalKey(text(chord, "key"))};
  if (flag(chord, "meta")) {
    out.modifiers |= Command;
  }
  if (flag(chord, "ctrl")) {
    out.modifiers |= Control;
  }
  if (flag(chord, "alt")) {
    out.modifiers |= Option;
  }
  if (flag(chord, "shift")) {
    out.modifiers |= Shift;
  }
  return out;
}

std::vector<MenuItem> parseMenu(const folly::dynamic &entries) {
  std::vector<MenuItem> out;
  if (!entries.isArray()) {
    return out;
  }
  for (const auto &entry : entries) {
    out.push_back(parseItem(entry));
  }
  return out;
}

std::vector<MenuItem> parseMenuBar(const folly::dynamic &groups, const DefaultMenuOptions &options) {
  std::vector<MenuItem> bar;
  if (groups.isArray()) {
    for (const auto &group : groups) {
      if (!group.isObject()) {
        continue;
      }
      bar.push_back(MenuItem{
          .title = text(group, "label"),
          .role = groupRole(text(group, "menuRole")),
          .items = parseMenu(group.getDefault("items")),
      });
    }
  }
  if (options.developer) {
    auto defaults = defaultMenuBar(options);
    auto developer = std::find_if(defaults.begin(), defaults.end(), [](const MenuItem &m) {
      return findMenuItem(m.items, MenuCommand::Reload) != nullptr;
    });
    auto help = std::find_if(bar.begin(), bar.end(), [](const MenuItem &m) { return m.role == MenuRole::Help; });
    bar.insert(help, *developer);
  }
  return bar;
}

std::optional<NavigationDirection> navigationFor(NavigationInput input) {
  switch (input) {
    case NavigationInput::MouseButton4:
    case NavigationInput::SwipeRight:
      return NavigationDirection::Back;
    case NavigationInput::MouseButton5:
    case NavigationInput::SwipeLeft:
      return NavigationDirection::Forward;
  }
  return std::nullopt;
}

std::optional<NavigationDirection> navigationFor(const KeyChord &chord) {
  if (chord.modifiers != Command) {
    return std::nullopt;
  }
  if (chord.key == "[") {
    return NavigationDirection::Back;
  }
  if (chord.key == "]") {
    return NavigationDirection::Forward;
  }
  return std::nullopt;
}

MenuHost::MenuHost(std::shared_ptr<MenuBackend> backend, DefaultMenuOptions options)
    : backend_(std::move(backend)), options_(std::move(options)) {
  backend_->setMenuBar(defaultMenuBar(options_));
}

void MenuHost::setMenuBar(const folly::dynamic &groups) {
  backend_->setMenuBar(parseMenuBar(groups, options_));
}

void MenuHost::setShortcuts(const folly::dynamic &shortcuts) {
  std::vector<std::pair<std::string, KeyChord>> parsed;
  if (shortcuts.isArray()) {
    for (const auto &shortcut : shortcuts) {
      if (shortcut.isObject()) {
        parsed.emplace_back(text(shortcut, "id"), parseChord(shortcut.getDefault("chord")));
      }
    }
  }
  std::lock_guard lock(mutex_);
  shortcuts_ = std::move(parsed);
}

void MenuHost::choose(const MenuItem &item, std::optional<SurfaceId> surface) {
  if (item.command == MenuCommand::AppItem) {
    send(folly::dynamic::object("type", "menuSelect")("id", item.id));
  } else if (item.command == MenuCommand::Back) {
    navigate(NavigationDirection::Back, surface);
  } else if (item.command == MenuCommand::Forward) {
    navigate(NavigationDirection::Forward, surface);
  }
}

bool MenuHost::keyDown(const KeyChord &pressed, bool textInputFocused) {
  KeyChord chord{.key = normalKey(pressed.key), .modifiers = pressed.modifiers};
  std::optional<std::string> id;
  {
    std::lock_guard lock(mutex_);
    for (const auto &[shortcutId, shortcut] : shortcuts_) {
      if (shortcut == chord) {
        id = shortcutId;
        break;
      }
    }
  }
  if (!id) {
    return false;
  }
  send(folly::dynamic::object("type", "shortcut")("id", *id)("textInputFocused", textInputFocused));
  return !(textInputFocused && editingChord(chord));
}

void MenuHost::navigate(NavigationDirection direction, std::optional<SurfaceId> surface) {
  folly::dynamic event = folly::dynamic::object("type", "navigate")("direction", directionName(direction));
  if (surface) {
    event["surface"] = *surface;
  }
  send(event);
}

std::shared_ptr<void> MenuHost::listen(Listener listener) {
  std::lock_guard lock(mutex_);
  int id = next_++;
  listeners_[id] = std::move(listener);
  return std::shared_ptr<void>(nullptr, [this, id](void *) {
    std::lock_guard lock(mutex_);
    listeners_.erase(id);
  });
}

void MenuHost::send(const folly::dynamic &event) {
  std::map<int, Listener> listeners;
  {
    std::lock_guard lock(mutex_);
    listeners = listeners_;
  }
  for (auto &[_, listener] : listeners) {
    listener(event);
  }
}

std::shared_ptr<NativeModule> makeMenusModule(std::shared_ptr<MenuHost> host) {
  struct Menus : NativeModule {
    std::shared_ptr<void> subscription;
    explicit Menus(std::shared_ptr<MenuHost> host) : NativeModule("NgNativeMenus") {
      auto appName = host->options().appName;
      constants([appName] { return folly::dynamic::object("menuBar", true)("appName", appName); });
      async("setMenuBar", [host](const folly::dynamic &args, std::vector<JsCallback>) {
        host->setMenuBar(args.size() > 0 ? args[0] : nullptr);
      });
      async("setShortcuts", [host](const folly::dynamic &args, std::vector<JsCallback>) {
        host->setShortcuts(args.size() > 0 ? args[0] : nullptr);
      });
      listeners();
      subscription = host->listen([this](const folly::dynamic &event) { emit(kEvent, event); });
    }
  };
  return std::make_shared<Menus>(std::move(host));
}

} // namespace ngn
