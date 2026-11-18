// The core takes every value that differs from one desktop OS to the next from the HostOs the
// backend passes in: none of macOS's own reach an OS that names others.
#include "fake-system.h"
#include "ngn/app-info.h"
#include "ngn/app-menus.h"
#include "ngn/desktop-modules.h"
#include "ngn/host-os.h"
#include "ngn/launch-settings.h"
#include "ngn/spawn-rules.h"

#include <doctest/doctest.h>

using folly::dynamic;
using ngn::MenuCommand;
using ngn::MenuItem;

namespace {

std::vector<MenuItem> otherMenuBar(const ngn::DefaultMenuOptions &options) {
  return {MenuItem{
      .title = options.appName,
      .items = {MenuItem{.title = "Quit", .command = MenuCommand::Quit, .key = "q", .modifiers = options.os.primaryModifier}},
  }};
}

// An OS that is not macOS, with values macOS has none of.
ngn::HostOs otherOs() {
  return {
      .id = "otheros",
      .name = "OtherOS",
      .program = "ngn-other",
      .primaryModifier = ngn::Control,
      .back = {.key = "ArrowLeft", .modifiers = ngn::Option},
      .forward = {.key = "ArrowRight", .modifiers = ngn::Option},
      .searchPath = {"/usr/local/bin", "/usr/bin"},
      .menuBar = otherMenuBar,
  };
}

struct FakeMenus final : ngn::MenuBackend {
  std::vector<std::vector<MenuItem>> bars;
  void setMenuBar(std::vector<MenuItem> bar) override {
    bars.push_back(std::move(bar));
  }
};

} // namespace

TEST_CASE("the default menu bar is the OS's") {
  auto bar = ngn::defaultMenuBar({.appName = "Notes", .os = otherOs()});
  REQUIRE(bar.size() == 1);
  CHECK(bar[0].title == "Notes");
  CHECK(bar[0].items[0].modifiers == ngn::Control);

  // The menu host draws it at launch.
  auto backend = std::make_shared<FakeMenus>();
  ngn::MenuHost host(backend, {.appName = "Notes", .os = otherOs()});
  REQUIRE(backend->bars.size() == 1);
  CHECK(backend->bars[0] == bar);
}

TEST_CASE("macOS's menu bar takes its Back and Forward keys from the OS") {
  auto os = ngn::macOS();
  os.back = {.key = "ArrowLeft", .modifiers = ngn::Option};
  os.forward = {.key = "ArrowRight", .modifiers = ngn::Option};
  auto bar = ngn::defaultMenuBar({.appName = "Notes", .os = os});
  auto back = ngn::findMenuItem(bar, MenuCommand::Back);
  auto forward = ngn::findMenuItem(bar, MenuCommand::Forward);
  REQUIRE(back);
  REQUIRE(forward);
  CHECK(back->key == "ArrowLeft");
  CHECK(back->modifiers == ngn::Option);
  CHECK(forward->key == "ArrowRight");
  CHECK(forward->modifiers == ngn::Option);
}

TEST_CASE("back and forward are the OS's own keys") {
  CHECK(ngn::navigationFor(ngn::KeyChord{.key = "ArrowLeft", .modifiers = ngn::Option}, otherOs()) == ngn::NavigationDirection::Back);
  CHECK(ngn::navigationFor(ngn::KeyChord{.key = "ArrowRight", .modifiers = ngn::Option}, otherOs()) == ngn::NavigationDirection::Forward);
  CHECK_FALSE(ngn::navigationFor(ngn::KeyChord{.key = "[", .modifiers = ngn::Command}, otherOs()));
  CHECK_FALSE(ngn::navigationFor(ngn::KeyChord{.key = "ArrowLeft", .modifiers = ngn::Option}, ngn::macOS()));
}

TEST_CASE("a focused text input keeps the editing keys under the OS's primary modifier") {
  auto host = std::make_shared<ngn::MenuHost>(std::make_shared<FakeMenus>(), ngn::DefaultMenuOptions{.appName = "Notes", .os = otherOs()});
  dynamic ctrl = dynamic::object("key", "z")("meta", false)("ctrl", true)("alt", false)("shift", false);
  dynamic meta = dynamic::object("key", "z")("meta", true)("ctrl", false)("alt", false)("shift", false);
  dynamic undo = dynamic::object("id", "undo")("chord", ctrl);
  dynamic metaUndo = dynamic::object("id", "meta")("chord", meta);
  host->setShortcuts(dynamic::array(undo, metaUndo));
  // Ctrl-Z goes on to the text input; Meta-Z is not an editing key here, so the app's shortcut takes it.
  CHECK_FALSE(host->keyDown({.key = "z", .modifiers = ngn::Control}, true));
  CHECK(host->keyDown({.key = "z", .modifiers = ngn::Command}, true));
}

TEST_CASE("the usage line names the OS's program, and updates go out for the OS") {
  auto none = [](const std::string &) -> std::optional<std::string> { return std::nullopt; };
  auto usage = ngn::launchSettings({.args = {}, .env = none, .plist = none}, otherOs());
  REQUIRE(std::holds_alternative<std::string>(usage));
  CHECK(std::get<std::string>(usage).starts_with("usage: ngn-other <bundle>"));

  auto settings = std::get<ngn::LaunchSettings>(ngn::launchSettings({.args = {"/tmp/b.js"}, .env = none, .plist = none}, otherOs()));
  CHECK(ngn::updatesConfigFrom(settings, otherOs(), "/data", "/tmp/b.js").platform == "otheros");
}

TEST_CASE("a bare program name is looked for on the OS's search path") {
  ngn::ProgramLookup lookup{
      .isExecutable = [](const std::string &path) { return path == "/opt/homebrew/bin/ffmpeg" || path == "/usr/local/bin/git" || path == "/usr/bin/git"; },
      .searchPath = otherOs().searchPath,
  };
  CHECK(ngn::resolveProgram("git", lookup) == "/usr/local/bin/git");
  CHECK_FALSE(ngn::resolveProgram("ffmpeg", lookup));
}

TEST_CASE("Device's OS name and a push token's type are the OS's") {
  CHECK(ngn::makeDeviceModule({}, otherOs().name)->property("osName") == dynamic("OtherOS"));

  ngn::DesktopModuleSources sources{
      .os = otherOs(),
      .system = std::make_shared<ngn::testing::FakeSystem>(),
      .state = std::make_shared<ngn::HostState>(),
      .notifications = [](std::shared_ptr<ngn::NotificationEvents>) { return std::shared_ptr<ngn::NotificationCenter>(); },
  };
  ngn::ModuleRegistry registry;
  auto made = ngn::addDesktopModules(registry, sources);
  std::vector<dynamic> heard;
  auto listening = made.notificationEvents->listen([&heard](const dynamic &event) { heard.push_back(event); });
  made.push->registered("a");
  made.push->registered("b");
  REQUIRE(heard.size() == 1);
  CHECK(heard[0]["token"]["type"] == "otheros");
}
