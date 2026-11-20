#include "ngn/dbus-menu.h"

#include <doctest/doctest.h>

using ngn::DbusMenuNode;
using ngn::MenuItem;

TEST_CASE("a tray menu is numbered depth first under the root, with its labels, states and the app's ids") {
  auto root = ngn::dbusMenuLayout({
      {.title = "Pause", .id = "0"},
      {.title = "Snooze", .items = {{.title = "5 min", .id = "1"}, {.title = "10 min", .id = "2", .disabled = true}}},
      {.separator = true},
      {.title = "Show_Hide", .id = "3", .checked = true},
  });
  CHECK(root.id == 0);
  REQUIRE(root.children.size() == 4);
  CHECK(root.children[0] == DbusMenuNode{.id = 1, .label = "Pause", .itemId = "0"});
  // A submenu names no item of the app's: its items do.
  const auto &snooze = root.children[1];
  CHECK(snooze.id == 2);
  CHECK(snooze.itemId.empty());
  REQUIRE(snooze.children.size() == 2);
  CHECK(snooze.children[0] == DbusMenuNode{.id = 3, .label = "5 min", .itemId = "1"});
  CHECK(snooze.children[1] == DbusMenuNode{.id = 4, .label = "10 min", .enabled = false, .itemId = "2"});
  CHECK(root.children[2].separator);
  CHECK(root.children[3] == DbusMenuNode{.id = 6, .label = "Show__Hide", .checked = true, .itemId = "3"});

  CHECK(ngn::findDbusMenuNode(root, 4)->itemId == "2");
  CHECK(ngn::findDbusMenuNode(root, 4)->command == ngn::MenuCommand::AppItem);
  CHECK(ngn::findDbusMenuNode(root, 0) == &root);
  CHECK(ngn::findDbusMenuNode(root, 99) == nullptr);
}

TEST_CASE("inline items join their parent between separators, with none at the ends or doubled") {
  auto root = ngn::dbusMenuLayout({
      {.separator = true},
      {.title = "Group", .items = {{.title = "A", .id = "a"}, {.title = "B", .id = "b"}}, .inlineItems = true},
      {.separator = true},
      {.title = "Quit", .id = "q"},
      {.separator = true},
  });
  std::vector<std::string> shape;
  for (const auto &node : root.children) {
    shape.push_back(node.separator ? "-" : node.label);
  }
  CHECK(shape == std::vector<std::string>{"A", "B", "-", "Quit"});
}

TEST_CASE("an item with the OS's command keeps it, for a click to run") {
  auto root = ngn::dbusMenuLayout({{.title = "Quit", .command = ngn::MenuCommand::Quit, .id = "q"}});
  REQUIRE(root.children.size() == 1);
  CHECK(root.children[0].command == ngn::MenuCommand::Quit);
}

TEST_CASE("the same menu sent again keeps its numbers") {
  std::vector<MenuItem> menu{{.title = "One", .id = "1"}, {.title = "Two", .id = "2"}};
  CHECK(ngn::dbusMenuLayout(menu) == ngn::dbusMenuLayout(menu));
  CHECK(ngn::dbusMenuLayout({}).children.empty());
}
