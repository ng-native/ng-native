#include "ngn/default-menu.h"

#include <doctest/doctest.h>

using ngn::MenuCommand;

namespace {

std::vector<std::string> titles(const std::vector<ngn::MenuItem> &menus) {
  std::vector<std::string> out;
  for (const auto &m : menus) {
    out.push_back(m.title);
  }
  return out;
}

} // namespace

TEST_CASE("the default menu bar has the app, File, Edit, View, Window and Help menus") {
  auto bar = ngn::defaultMenuBar({.appName = "Notes", .os = ngn::macOS()});
  CHECK(titles(bar) == std::vector<std::string>{"Notes", "File", "Edit", "View", "Window", "Help"});
  CHECK(bar[0].role == ngn::MenuRole::App);
  CHECK(bar[4].role == ngn::MenuRole::Window);
  CHECK(bar[5].role == ngn::MenuRole::Help);
}

TEST_CASE("Quit is Command-Q in the app menu, named for the app") {
  auto bar = ngn::defaultMenuBar({.appName = "Notes", .os = ngn::macOS()});
  auto quit = ngn::findMenuItem(bar, MenuCommand::Quit);
  REQUIRE(quit);
  CHECK(quit->title == "Quit Notes");
  CHECK(quit->key == "q");
  CHECK(quit->modifiers == ngn::Command);
  CHECK(bar[0].items.back().command == MenuCommand::Quit);
}

TEST_CASE("the Edit menu has the standard text commands with their keys") {
  auto bar = ngn::defaultMenuBar({.appName = "Notes", .os = ngn::macOS()});
  struct Expected {
    MenuCommand command;
    const char *key;
    unsigned modifiers;
  };
  for (auto e : {
           Expected{MenuCommand::Undo, "z", ngn::Command},
           Expected{MenuCommand::Redo, "z", ngn::Command | ngn::Shift},
           Expected{MenuCommand::Cut, "x", ngn::Command},
           Expected{MenuCommand::Copy, "c", ngn::Command},
           Expected{MenuCommand::Paste, "v", ngn::Command},
           Expected{MenuCommand::SelectAll, "a", ngn::Command},
       }) {
    auto found = ngn::findMenuItem(bar[2].items, e.command);
    REQUIRE(found);
    CHECK(found->key == e.key);
    CHECK(found->modifiers == e.modifiers);
  }
  // A command without a key equivalent has no modifiers either.
  CHECK(ngn::findMenuItem(bar, MenuCommand::Delete)->modifiers == 0);
}

TEST_CASE("the window commands close, minimise and zoom") {
  auto bar = ngn::defaultMenuBar({.appName = "Notes", .os = ngn::macOS()});
  CHECK(ngn::findMenuItem(bar, MenuCommand::CloseWindow)->key == "w");
  CHECK(ngn::findMenuItem(bar[4].items, MenuCommand::Minimize)->key == "m");
  CHECK(ngn::findMenuItem(bar[4].items, MenuCommand::Zoom));
  CHECK(ngn::findMenuItem(bar[4].items, MenuCommand::BringAllToFront));
}

TEST_CASE("View has Back and Forward on Command-[ and Command-] before the app sets its own bar") {
  auto bar = ngn::defaultMenuBar({.appName = "Notes", .os = ngn::macOS()});
  auto back = ngn::findMenuItem(bar[3].items, MenuCommand::Back);
  auto forward = ngn::findMenuItem(bar[3].items, MenuCommand::Forward);
  REQUIRE(back);
  REQUIRE(forward);
  CHECK(back->key == "[");
  CHECK(forward->key == "]");
  CHECK(back->modifiers == ngn::Command);
}

TEST_CASE("View has Show Sidebar on Control-Command-S, which a window's split view answers") {
  auto bar = ngn::defaultMenuBar({.appName = "Notes", .os = ngn::macOS()});
  auto sidebar = ngn::findMenuItem(bar[3].items, MenuCommand::ToggleSidebar);
  REQUIRE(sidebar);
  CHECK(sidebar->title == "Show Sidebar");
  CHECK(sidebar->key == "s");
  CHECK(sidebar->modifiers == (ngn::Command | ngn::Control));
}

TEST_CASE("a bundle from a dev server adds the Developer menu with Reload on Command-R") {
  CHECK_FALSE(ngn::findMenuItem(ngn::defaultMenuBar({.appName = "Notes", .os = ngn::macOS()}), MenuCommand::Reload));
  auto bar = ngn::defaultMenuBar({.appName = "Notes", .developer = true, .os = ngn::macOS()});
  CHECK(titles(bar) == std::vector<std::string>{"Notes", "File", "Edit", "View", "Window", "Developer", "Help"});
  auto reload = ngn::findMenuItem(bar, MenuCommand::Reload);
  REQUIRE(reload);
  CHECK(reload->key == "r");
  CHECK(reload->modifiers == ngn::Command);
  // React Native DevTools, on Safari's and Chrome's Web Inspector shortcut.
  auto devTools = ngn::findMenuItem(bar, MenuCommand::OpenDevTools);
  REQUIRE(devTools);
  CHECK(devTools->title == "Open DevTools");
  CHECK(devTools->key == "i");
  CHECK(devTools->modifiers == (ngn::Command | ngn::Option));
  CHECK_FALSE(ngn::findMenuItem(ngn::defaultMenuBar({.appName = "Notes", .os = ngn::macOS()}), MenuCommand::OpenDevTools));
}

TEST_CASE("File has Print... on Command-P, after Close Window") {
  auto bar = ngn::defaultMenuBar({.appName = "Notes", .os = ngn::macOS()});
  const auto &file = bar[1].items;
  REQUIRE(file.size() == 3);
  CHECK(file[0].command == MenuCommand::CloseWindow);
  CHECK(file[1].separator);
  CHECK(file[2].title == "Print...");
  CHECK(file[2].command == MenuCommand::Print);
  CHECK(file[2].key == "p");
  CHECK(file[2].modifiers == ngn::Command);
}

TEST_CASE("Linux's menu bar: the app's groups, then the app's menu with About and Quit on Ctrl+Q") {
  auto bar = ngn::defaultMenuBar({.appName = "Notes", .os = ngn::linuxOs()});
  CHECK(titles(bar) == std::vector<std::string>{"File", "Edit", "View", "Notes"});
  auto quit = ngn::findMenuItem(bar, MenuCommand::Quit);
  REQUIRE(quit);
  CHECK(quit->key == "q");
  CHECK(quit->modifiers == ngn::Control);
  CHECK(bar.back().items.back().command == MenuCommand::Quit);
  // Nothing of macOS's own: no Hide, Services, Minimize, Zoom or window list.
  for (auto command : {MenuCommand::Hide, MenuCommand::HideOthers, MenuCommand::ShowAll, MenuCommand::Minimize, MenuCommand::Zoom,
                       MenuCommand::BringAllToFront}) {
    CHECK_FALSE(ngn::findMenuItem(bar, command));
  }
  auto undo = ngn::findMenuItem(bar, MenuCommand::Undo);
  REQUIRE(undo);
  CHECK(undo->modifiers == ngn::Control);
  auto back = ngn::findMenuItem(bar, MenuCommand::Back);
  REQUIRE(back);
  CHECK(back->key == "ArrowLeft");
  CHECK(back->modifiers == ngn::Option);
}

TEST_CASE("Linux's Developer menu reloads on Ctrl+R") {
  CHECK_FALSE(ngn::findMenuItem(ngn::defaultMenuBar({.appName = "Notes", .os = ngn::linuxOs()}), MenuCommand::Reload));
  auto bar = ngn::defaultMenuBar({.appName = "Notes", .developer = true, .os = ngn::linuxOs()});
  auto reload = ngn::findMenuItem(bar, MenuCommand::Reload);
  REQUIRE(reload);
  CHECK(reload->key == "r");
  CHECK(reload->modifiers == ngn::Control);
}
