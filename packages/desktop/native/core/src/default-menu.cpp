#include "ngn/default-menu.h"

#include <cctype>

namespace ngn {

namespace {

MenuItem item(std::string title, MenuCommand command, std::string key = "", unsigned modifiers = Command) {
  unsigned keyModifiers = key.empty() ? 0 : modifiers;
  return MenuItem{.title = std::move(title), .command = command, .key = std::move(key), .modifiers = keyModifiers};
}

MenuItem separator() {
  return MenuItem{.separator = true};
}

MenuItem menu(std::string title, std::vector<MenuItem> items, MenuRole role = MenuRole::None) {
  return MenuItem{.title = std::move(title), .role = role, .items = std::move(items)};
}

} // namespace

std::vector<MenuItem> defaultMenuBar(const DefaultMenuOptions &options) {
  return options.os.menuBar(options);
}

std::vector<MenuItem> macOSMenuBar(const DefaultMenuOptions &options) {
  const std::string &app = options.appName;
  std::vector<MenuItem> bar{
      menu(
          app,
          {
              item("About " + app, MenuCommand::About),
              separator(),
              menu("Services", {}, MenuRole::Services),
              separator(),
              item("Hide " + app, MenuCommand::Hide, "h"),
              item("Hide Others", MenuCommand::HideOthers, "h", Command | Option),
              item("Show All", MenuCommand::ShowAll),
              separator(),
              item("Quit " + app, MenuCommand::Quit, "q"),
          },
          MenuRole::App),
      menu("File", {item("Close Window", MenuCommand::CloseWindow, "w"), separator(), item("Print...", MenuCommand::Print, "p")}),
      menu(
          "Edit",
          {
              item("Undo", MenuCommand::Undo, "z"),
              item("Redo", MenuCommand::Redo, "z", Command | Shift),
              separator(),
              item("Cut", MenuCommand::Cut, "x"),
              item("Copy", MenuCommand::Copy, "c"),
              item("Paste", MenuCommand::Paste, "v"),
              item("Paste and Match Style", MenuCommand::PasteAndMatchStyle, "v", Command | Option | Shift),
              item("Delete", MenuCommand::Delete),
              item("Select All", MenuCommand::SelectAll, "a"),
          }),
      menu(
          "View",
          {
              item("Back", MenuCommand::Back, options.os.back.key, options.os.back.modifiers),
              item("Forward", MenuCommand::Forward, options.os.forward.key, options.os.forward.modifiers),
              separator(),
              item("Show Sidebar", MenuCommand::ToggleSidebar, "s", Command | Control),
              item("Enter Full Screen", MenuCommand::ToggleFullScreen, "f", Command | Control),
          }),
      menu(
          "Window",
          {
              item("Minimize", MenuCommand::Minimize, "m"),
              item("Zoom", MenuCommand::Zoom),
              separator(),
              item("Bring All to Front", MenuCommand::BringAllToFront),
          },
          MenuRole::Window),
  };
  if (options.developer) {
    bar.push_back(menu(
        "Developer",
        {
            item("Reload", MenuCommand::Reload, "r"),
            item("Open DevTools", MenuCommand::OpenDevTools, "i", Command | Option),
        }));
  }
  bar.push_back(menu("Help", {}, MenuRole::Help));
  return bar;
}

MenuPlacement linuxMenuPlacement(std::string_view currentDesktop) {
  while (!currentDesktop.empty()) {
    auto colon = currentDesktop.find(':');
    if (currentDesktop.substr(0, colon) == "KDE") {
      return MenuPlacement::MenuBar;
    }
    currentDesktop = colon == std::string_view::npos ? std::string_view() : currentDesktop.substr(colon + 1);
  }
  return MenuPlacement::PrimaryMenu;
}

std::vector<MenuItem> linuxMenuBar(const DefaultMenuOptions &options) {
  const std::string &app = options.appName;
  std::vector<MenuItem> bar{
      menu("File", {item("Close Window", MenuCommand::CloseWindow, "w", Control), separator(), item("Print...", MenuCommand::Print, "p", Control)}),
      menu(
          "Edit",
          {
              item("Undo", MenuCommand::Undo, "z", Control),
              item("Redo", MenuCommand::Redo, "z", Control | Shift),
              separator(),
              item("Cut", MenuCommand::Cut, "x", Control),
              item("Copy", MenuCommand::Copy, "c", Control),
              item("Paste", MenuCommand::Paste, "v", Control),
              item("Delete", MenuCommand::Delete),
              item("Select All", MenuCommand::SelectAll, "a", Control),
          }),
      menu(
          "View",
          {
              item("Back", MenuCommand::Back, options.os.back.key, options.os.back.modifiers),
              item("Forward", MenuCommand::Forward, options.os.forward.key, options.os.forward.modifiers),
              separator(),
              item("Show Sidebar", MenuCommand::ToggleSidebar, "F9", 0),
              item("Full Screen", MenuCommand::ToggleFullScreen, "F11", 0),
          }),
  };
  if (options.developer) {
    bar.push_back(menu(
        "Developer",
        {
            item("Reload", MenuCommand::Reload, "r", Control),
            item("Open DevTools", MenuCommand::OpenDevTools, "i", Control | Shift),
        }));
  }
  bar.push_back(menu(app, {item("About " + app, MenuCommand::About), separator(), item("Quit", MenuCommand::Quit, "q", Control)}));
  return bar;
}

namespace {

std::string lowerKey(std::string key) {
  if (key.size() == 1) {
    key[0] = static_cast<char>(std::tolower(static_cast<unsigned char>(key[0])));
  }
  return key;
}

} // namespace

const MenuItem *findMenuItem(const std::vector<MenuItem> &menus, const KeyChord &chord) {
  for (const auto &m : menus) {
    if (m.separator || m.disabled) {
      continue;
    }
    if (m.items.empty() && !m.key.empty() && m.modifiers == chord.modifiers && lowerKey(m.key) == lowerKey(chord.key)) {
      return &m;
    }
    if (auto found = findMenuItem(m.items, chord)) {
      return found;
    }
  }
  return nullptr;
}

bool isEditingCommand(MenuCommand command) {
  switch (command) {
    case MenuCommand::Undo:
    case MenuCommand::Redo:
    case MenuCommand::Cut:
    case MenuCommand::Copy:
    case MenuCommand::Paste:
    case MenuCommand::PasteAndMatchStyle:
    case MenuCommand::Delete:
    case MenuCommand::SelectAll:
      return true;
    default:
      return false;
  }
}

const MenuItem *findMenuItem(const std::vector<MenuItem> &menus, MenuCommand command) {
  for (const auto &m : menus) {
    if (m.command == command && !m.separator) {
      return &m;
    }
    if (auto found = findMenuItem(m.items, command)) {
      return found;
    }
  }
  return nullptr;
}

} // namespace ngn
