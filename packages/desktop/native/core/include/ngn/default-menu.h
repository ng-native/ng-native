// The menu bar every desktop app gets at launch, before any JavaScript runs: its OS's (HostOs's
// menuBar). On macOS, the app menu with Quit, File's Close Window and Print... (which prints the
// key window), the standard text editing commands, View's Back, Forward and Show Sidebar, the
// window commands and, for a bundle from a dev server, the developer commands. A backend draws it
// and maps each command to the toolkit's own. The app's own bar replaces it once the app sets one
// (app-menus.h).
#pragma once

#include "ngn/host-os.h"

#include <string>
#include <vector>

namespace ngn {

enum class MenuCommand {
  None,
  About,
  Hide,
  HideOthers,
  ShowAll,
  Quit,
  CloseWindow,
  Undo,
  Redo,
  Cut,
  Copy,
  Paste,
  PasteAndMatchStyle,
  Delete,
  SelectAll,
  ToggleFullScreen,
  Minimize,
  Zoom,
  BringAllToFront,
  Reload,
  // React Native DevTools, through the dev server's inspector proxy (Developer menu).
  OpenDevTools,
  Find,
  ToggleSidebar,
  Print,
  // Back and forward through the window's history: the app hears them as `navigate`.
  Back,
  Forward,
  // An app's own item: the app hears it as `menuSelect` with the item's id.
  AppItem,
};

// The key equivalent's modifiers, as a bitmask: Command is the web's `meta` key and Option its
// `alt`. Which one is the OS's primary modifier is HostOs's primaryModifier.
enum MenuModifier : unsigned {
  Command = 1 << 0,
  Shift = 1 << 1,
  Option = 1 << 2,
  Control = 1 << 3,
};

// What the toolkit's own menus add to a menu: AppKit fills the Services and Window menus.
enum class MenuRole { None, App, Services, Window, Help };

struct MenuItem {
  std::string title;
  MenuCommand command{MenuCommand::None};
  // A key equivalent: a character such as "q", a key named as the web names it ("ArrowLeft",
  // "Enter", "F5"), or empty for none.
  std::string key;
  unsigned modifiers{0};
  bool separator{false};
  MenuRole role{MenuRole::None};
  std::vector<MenuItem> items;
  // An app's item: the id the app knows it by, and how it is drawn.
  std::string id;
  bool disabled{false};
  bool checked{false};
  bool destructive{false};
  std::string subtitle;
  std::string sfSymbol;
  // Its items are drawn in place, between separators, rather than as a submenu.
  bool inlineItems{false};

  bool operator==(const MenuItem &) const = default;
};

struct DefaultMenuOptions {
  std::string appName;
  // Adds the Developer menu (Reload) for a bundle from a dev server.
  bool developer{false};
  // The OS whose menu bar it is, and whose primary modifier and back and forward keys the app's
  // menus and shortcuts follow.
  HostOs os;
};

// The OS's bar: `options.os.menuBar`.
std::vector<MenuItem> defaultMenuBar(const DefaultMenuOptions &options);
// macOS's bar (HostOs's menuBar for macOS).
std::vector<MenuItem> macOSMenuBar(const DefaultMenuOptions &options);
// Linux's (HostOs's menuBar for Linux): the app's groups, then a menu named for the app with About
// and Quit. None of macOS's Hide, Services, Minimize, Zoom or window list.
std::vector<MenuItem> linuxMenuBar(const DefaultMenuOptions &options);

// The item with this command anywhere in `menus`, or null.
const MenuItem *findMenuItem(const std::vector<MenuItem> &menus, MenuCommand command);

} // namespace ngn
