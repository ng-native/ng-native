#include "ngn/app-menus.h"

#include <doctest/doctest.h>
#include <folly/json.h>

using folly::dynamic;
using ngn::KeyChord;
using ngn::MenuCommand;
using ngn::MenuHost;
using ngn::MenuItem;
using ngn::NavigationInput;

namespace {

std::string sortedJson(const dynamic &value) {
  folly::json::serialization_opts opts;
  opts.sort_keys = true;
  return folly::json::serialize(value, opts);
}

struct FakeMenus final : ngn::MenuBackend {
  std::vector<std::vector<MenuItem>> bars;
  void setMenuBar(std::vector<MenuItem> bar) override {
    bars.push_back(std::move(bar));
  }
};

struct Fixture {
  std::shared_ptr<FakeMenus> backend = std::make_shared<FakeMenus>();
  std::shared_ptr<MenuHost> host =
      std::make_shared<MenuHost>(backend, ngn::DefaultMenuOptions{.appName = "Notes", .developer = true});
  std::shared_ptr<ngn::NativeModule> module = ngn::makeMenusModule(host);
  std::vector<std::string> events;

  Fixture() {
    module->setEmitter([this](const std::string &event, dynamic body) {
      events.push_back(event + " " + sortedJson(body));
    });
  }
};

dynamic chord(std::string key, bool meta = true, bool shift = false) {
  return dynamic::object("key", key)("meta", meta)("ctrl", false)("alt", false)("shift", shift);
}

// The bar as the app sends it: the defaults merged with its own, as `Menus` makes it.
dynamic appBar() {
  return dynamic::array(
      dynamic::object("label", "Notes")("menuRole", "app")(
          "items",
          dynamic::array(
              dynamic::object("id", "0.0")("label", "About Notes")("menuRole", "about"),
              dynamic::object("separator", true),
              dynamic::object("id", "0.2")("label", "Settings...")("menuRole", "settings")("handled", true)(
                  "shortcut", chord(",")),
              dynamic::object("id", "0.3")("label", "Services")("menuRole", "services"),
              dynamic::object("id", "0.4")("label", "Quit Notes")("menuRole", "quit")("shortcut", chord("q")))),
      dynamic::object("label", "File")(
          "items",
          dynamic::array(
              dynamic::object("id", "1.0")("label", "New")("shortcut", chord("n")),
              dynamic::object("id", "1.1")("label", "Save")("disabled", true)("shortcut", chord("s")),
              dynamic::object("id", "1.2")("label", "Export")(
                  "items",
                  dynamic::array(
                      dynamic::object("id", "1.2.0")("label", "PDF")("sfSymbol", "doc")("checked", true),
                      dynamic::object("id", "1.2.1")("label", "Delete all")("destructive", true)(
                          "subtitle", "Cannot be undone"))))),
      dynamic::object("label", "Edit")("menuRole", "edit")(
          "items",
          dynamic::array(
              dynamic::object("id", "2.0")("label", "Copy Note")("menuRole", "copy")("shortcut", chord("c")),
              dynamic::object("id", "2.1")("label", "Paste")("menuRole", "paste")("handled", true)(
                  "shortcut", chord("v")))),
      dynamic::object("label", "View")("menuRole", "view")(
          "items",
          dynamic::array(
              dynamic::object("id", "3.0")("label", "Back")("menuRole", "back")("shortcut", chord("[")),
              dynamic::object("id", "3.1")("label", "Show Sidebar")("menuRole", "toggleSidebar")(
                  "shortcut", dynamic::object("key", "s")("meta", true)("ctrl", true)("alt", false)("shift", false)))),
      dynamic::object("label", "Window")("menuRole", "window")("items", dynamic::array()),
      dynamic::object("label", "Help")("menuRole", "help")("items", dynamic::array()));
}

std::vector<std::string> titles(const std::vector<MenuItem> &menus) {
  std::vector<std::string> out;
  for (const auto &m : menus) {
    out.push_back(m.separator ? "-" : m.title);
  }
  return out;
}

} // namespace

TEST_CASE("NgNativeMenus draws a menu bar, named for the app, and shows the default one until the app sets its own") {
  Fixture f;
  auto constants = f.module->call("getConstants");
  CHECK(constants["menuBar"] == true);
  CHECK(constants["appName"] == "Notes");
  REQUIRE(f.backend->bars.size() == 1);
  CHECK(f.backend->bars[0] == ngn::defaultMenuBar({.appName = "Notes", .developer = true}));
}

TEST_CASE("the app's bar is drawn as it sent it, with the Developer menu kept before Help") {
  Fixture f;
  f.module->call("setMenuBar", dynamic::array(appBar()));
  REQUIRE(f.backend->bars.size() == 2);
  const auto &bar = f.backend->bars[1];
  CHECK(titles(bar) == std::vector<std::string>{"Notes", "File", "Edit", "View", "Window", "Developer", "Help"});
  CHECK(bar[0].role == ngn::MenuRole::App);
  CHECK(bar[4].role == ngn::MenuRole::Window);
  CHECK(bar[6].role == ngn::MenuRole::Help);

  // A role item is the OS's own unless the app handles it.
  const auto &app = bar[0].items;
  CHECK(titles(app) == std::vector<std::string>{"About Notes", "-", "Settings...", "Services", "Quit Notes"});
  CHECK(app[0].command == MenuCommand::About);
  CHECK(app[2].command == MenuCommand::AppItem);
  CHECK(app[2].id == "0.2");
  CHECK(app[2].key == ",");
  CHECK(app[2].modifiers == ngn::Command);
  CHECK(app[3].role == ngn::MenuRole::Services);
  CHECK(app[4].command == MenuCommand::Quit);
  CHECK(bar[2].items[0].command == MenuCommand::Copy);
  CHECK(bar[2].items[0].title == "Copy Note");
  CHECK(bar[2].items[1].command == MenuCommand::AppItem);
  CHECK(bar[3].items[0].command == MenuCommand::Back);
  CHECK(bar[3].items[1].command == MenuCommand::ToggleSidebar);
  CHECK(bar[3].items[1].modifiers == (ngn::Command | ngn::Control));

  const auto &file = bar[1].items;
  // Cmd-W stays: Close Window ends the app's File menu when its bar has no close item.
  CHECK(titles(file) == std::vector<std::string>{"New", "Save", "Export", "-", "Close Window"});
  CHECK(file.back().command == MenuCommand::CloseWindow);
  CHECK(file.back().key == "w");
  CHECK(file[0].command == MenuCommand::AppItem);
  CHECK(file[0].key == "n");
  CHECK(file[1].disabled);
  const auto &exportMenu = file[2];
  REQUIRE(exportMenu.items.size() == 2);
  CHECK(exportMenu.items[0].sfSymbol == "doc");
  CHECK(exportMenu.items[0].checked);
  CHECK(exportMenu.items[1].destructive);
  CHECK(exportMenu.items[1].subtitle == "Cannot be undone");
}

TEST_CASE("a bar with no File menu gets one for Close Window, after the app menu; one with a close item keeps its own") {
  Fixture f;
  f.module->call(
      "setMenuBar",
      dynamic::array(dynamic::array(
          dynamic::object("label", "Notes")("menuRole", "app")("items", dynamic::array()),
          dynamic::object("label", "Help")("menuRole", "help")("items", dynamic::array()))));
  CHECK(titles(f.backend->bars.back()) == std::vector<std::string>{"Notes", "File", "Developer", "Help"});
  CHECK(titles(f.backend->bars.back()[1].items) == std::vector<std::string>{"Close Window"});

  f.module->call(
      "setMenuBar",
      dynamic::array(dynamic::array(dynamic::object("label", "Window")("menuRole", "window")(
          "items", dynamic::array(dynamic::object("id", "0.0")("label", "Close Tab")("menuRole", "close")(
                       "shortcut", chord("w")))))));
  CHECK(titles(f.backend->bars.back()) == std::vector<std::string>{"Window", "Developer"});
}

TEST_CASE("choosing an app item or a handled role item tells the app its id; back and forward navigate") {
  Fixture f;
  f.module->call("setMenuBar", dynamic::array(appBar()));
  const auto &bar = f.backend->bars.back();
  f.host->choose(bar[1].items[0], 11);
  f.host->choose(bar[2].items[1], 11);
  f.host->choose(bar[3].items[0], 21);
  // The OS's own items never reach the app.
  f.host->choose(bar[2].items[0], 11);
  CHECK(f.events == std::vector<std::string>{
                        "ngNativeMenus {\"id\":\"1.0\",\"type\":\"menuSelect\"}",
                        "ngNativeMenus {\"id\":\"2.1\",\"type\":\"menuSelect\"}",
                        "ngNativeMenus {\"direction\":\"back\",\"surface\":21,\"type\":\"navigate\"}",
                    });
}

TEST_CASE("a shortcut the app listens for is its, and says whether a text input had focus") {
  Fixture f;
  f.module->call(
      "setShortcuts",
      dynamic::array(dynamic::array(
          dynamic::object("id", "s0")("chord", chord("k"))("label", "Search")("group", "Notes"),
          dynamic::object("id", "s1")("chord", chord("c"))("label", "Copy link")("group", "Notes"),
          dynamic::object("id", "s2")("chord", chord("?", false, true))("label", "Help")("group", "Notes"),
          dynamic::object("id", "s3")("chord", chord("ArrowDown", false))("label", "Next")("group", "Notes"))));

  CHECK(f.host->keyDown({.key = "k", .modifiers = ngn::Command}, false));
  CHECK(f.host->keyDown({.key = "K", .modifiers = ngn::Command}, true));
  CHECK(f.host->keyDown({.key = "?", .modifiers = ngn::Shift}, false));
  CHECK(f.host->keyDown({.key = "ArrowDown"}, false));
  // Another chord, or the same key with other modifiers, is not the app's.
  CHECK_FALSE(f.host->keyDown({.key = "k", .modifiers = ngn::Command | ngn::Shift}, false));
  CHECK_FALSE(f.host->keyDown({.key = "j", .modifiers = ngn::Command}, false));
  CHECK(f.events == std::vector<std::string>{
                        "ngNativeMenus {\"id\":\"s0\",\"textInputFocused\":false,\"type\":\"shortcut\"}",
                        "ngNativeMenus {\"id\":\"s0\",\"textInputFocused\":true,\"type\":\"shortcut\"}",
                        "ngNativeMenus {\"id\":\"s2\",\"textInputFocused\":false,\"type\":\"shortcut\"}",
                        "ngNativeMenus {\"id\":\"s3\",\"textInputFocused\":false,\"type\":\"shortcut\"}",
                    });
  f.events.clear();

  // An editing key goes on to a focused text input, which owns it; the app still hears it.
  CHECK_FALSE(f.host->keyDown({.key = "c", .modifiers = ngn::Command}, true));
  CHECK(f.host->keyDown({.key = "c", .modifiers = ngn::Command}, false));
  CHECK(f.events.size() == 2);
  CHECK(f.events[0] == "ngNativeMenus {\"id\":\"s1\",\"textInputFocused\":true,\"type\":\"shortcut\"}");

  // A new list replaces the old.
  f.module->call("setShortcuts", dynamic::array(dynamic::array()));
  CHECK_FALSE(f.host->keyDown({.key = "k", .modifiers = ngn::Command}, false));
}

TEST_CASE("the OS's back and forward inputs become navigate, in the window they were in") {
  Fixture f;
  using ngn::NavigationDirection;
  CHECK(ngn::navigationFor(NavigationInput::MouseButton4) == NavigationDirection::Back);
  CHECK(ngn::navigationFor(NavigationInput::MouseButton5) == NavigationDirection::Forward);
  CHECK(ngn::navigationFor(NavigationInput::SwipeRight) == NavigationDirection::Back);
  CHECK(ngn::navigationFor(NavigationInput::SwipeLeft) == NavigationDirection::Forward);
  // Command-Left stays with text editing.
  CHECK(ngn::navigationFor(KeyChord{.key = "[", .modifiers = ngn::Command}) == NavigationDirection::Back);
  CHECK(ngn::navigationFor(KeyChord{.key = "]", .modifiers = ngn::Command}) == NavigationDirection::Forward);
  CHECK_FALSE(ngn::navigationFor(KeyChord{.key = "ArrowLeft", .modifiers = ngn::Command}));
  CHECK_FALSE(ngn::navigationFor(KeyChord{.key = "[", .modifiers = ngn::Command | ngn::Shift}));

  f.host->navigate(NavigationDirection::Forward, 31);
  f.host->navigate(NavigationDirection::Back, std::nullopt);
  CHECK(f.events == std::vector<std::string>{
                        "ngNativeMenus {\"direction\":\"forward\",\"surface\":31,\"type\":\"navigate\"}",
                        "ngNativeMenus {\"direction\":\"back\",\"type\":\"navigate\"}",
                    });
}

TEST_CASE("a context menu reads the entries a view's contextMenu prop gives") {
  auto entries = ngn::parseMenu(dynamic::array(
      dynamic::object("id", "0")("label", "Rename"),
      dynamic::object("separator", true),
      dynamic::object("id", "2")("label", "Copy")("menuRole", "copy"),
      dynamic::object("id", "3")("label", "Share")(
          "items", dynamic::array(dynamic::object("id", "3.0")("label", "Mail")))));
  CHECK(titles(entries) == std::vector<std::string>{"Rename", "-", "Copy", "Share"});
  CHECK(entries[0].command == MenuCommand::AppItem);
  CHECK(entries[2].command == MenuCommand::Copy);
  CHECK(entries[3].items[0].id == "3.0");
  CHECK(ngn::parseMenu(nullptr).empty());
}
