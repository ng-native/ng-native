// The menu bar every desktop app gets at launch, before any JavaScript runs: the app menu with
// Quit, the standard text editing commands, the window commands and, for a bundle from a dev
// server, the developer commands. A backend draws it and maps each command to the toolkit's own.
#pragma once

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
};

// The key equivalent's modifiers, as a bitmask. Command is the platform's primary modifier
// (Control off macOS).
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
  // A key equivalent such as "q", or empty for none.
  std::string key;
  unsigned modifiers{0};
  bool separator{false};
  MenuRole role{MenuRole::None};
  std::vector<MenuItem> items;
};

struct DefaultMenuOptions {
  std::string appName;
  // Adds the Developer menu (Reload) for a bundle from a dev server.
  bool developer{false};
};

std::vector<MenuItem> defaultMenuBar(const DefaultMenuOptions &options);

// The item with this command anywhere in `menus`, or null.
const MenuItem *findMenuItem(const std::vector<MenuItem> &menus, MenuCommand command);

} // namespace ngn
