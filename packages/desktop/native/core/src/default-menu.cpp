#include "ngn/default-menu.h"

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
      menu("File", {item("Close Window", MenuCommand::CloseWindow, "w")}),
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
              item("Back", MenuCommand::Back, "["),
              item("Forward", MenuCommand::Forward, "]"),
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
    bar.push_back(menu("Developer", {item("Reload", MenuCommand::Reload, "r")}));
  }
  bar.push_back(menu("Help", {}, MenuRole::Help));
  return bar;
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
