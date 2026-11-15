#include "ngn/tray-and-dock.h"

#include <doctest/doctest.h>
#include <folly/json.h>

using folly::dynamic;
using ngn::DockHost;
using ngn::MenuCommand;
using ngn::TrayHost;
using ngn::TrayIcon;

namespace {

std::string sortedJson(const dynamic &value) {
  folly::json::serialization_opts opts;
  opts.sort_keys = true;
  return folly::json::serialize(value, opts);
}

struct FakeTray final : ngn::TrayBackend {
  std::vector<std::vector<TrayIcon>> sets;
  void setIcons(std::vector<TrayIcon> icons) override {
    sets.push_back(std::move(icons));
  }
};

struct FakeDock final : ngn::DockBackend {
  std::vector<std::optional<std::vector<ngn::MenuItem>>> menus;
  std::vector<std::string> log;
  void setMenu(std::optional<std::vector<ngn::MenuItem>> menu) override {
    menus.push_back(std::move(menu));
  }
  void bounce(int id, bool critical) override {
    log.push_back("bounce " + std::to_string(id) + (critical ? " critical" : ""));
  }
  void cancelBounce(int id) override {
    log.push_back("cancel " + std::to_string(id));
  }
};

std::shared_ptr<ngn::NativeModule> recording(std::shared_ptr<ngn::NativeModule> module, std::vector<std::string> &out) {
  module->setEmitter([&out](const std::string &event, dynamic body) { out.push_back(event + " " + sortedJson(body)); });
  return module;
}

} // namespace

TEST_CASE("NgNativeTray draws each icon the app sends, with its menu or as a press") {
  auto backend = std::make_shared<FakeTray>();
  auto host = std::make_shared<TrayHost>(backend);
  std::vector<std::string> events;
  auto module = recording(ngn::makeTrayModule(host), events);
  module->call(
      "setIcons",
      dynamic::array(dynamic::array(
          dynamic::object("id", "t0")("title", "25:00")("sfSymbol", "timer")("tooltip", "Focus timer")(
              "menu", dynamic::array(dynamic::object("id", "0")("label", "Pause"))),
          dynamic::object("id", "t1")("image", "sync")("menu", nullptr))));
  REQUIRE(backend->sets.size() == 1);
  const auto &icons = backend->sets[0];
  REQUIRE(icons.size() == 2);
  CHECK(icons[0].id == "t0");
  CHECK(icons[0].title == "25:00");
  CHECK(icons[0].sfSymbol == "timer");
  CHECK(icons[0].tooltip == "Focus timer");
  REQUIRE(icons[0].menu);
  CHECK((*icons[0].menu)[0].title == "Pause");
  CHECK((*icons[0].menu)[0].command == MenuCommand::AppItem);
  CHECK(icons[1].image == "sync");
  CHECK_FALSE(icons[1].menu);

  host->menuSelect("t0", "0");
  host->press("t1");
  CHECK(events == std::vector<std::string>{
                      "ngNativeTray {\"icon\":\"t0\",\"id\":\"0\",\"type\":\"menuSelect\"}",
                      "ngNativeTray {\"icon\":\"t1\",\"type\":\"press\"}",
                  });
}

TEST_CASE("a reloaded app's tray starts empty, so no icon outlives the app that made it") {
  auto backend = std::make_shared<FakeTray>();
  auto host = std::make_shared<TrayHost>(backend);
  std::vector<std::string> events;
  auto first = recording(ngn::makeTrayModule(host), events);
  first->call("setIcons", dynamic::array(dynamic::array(dynamic::object("id", "t0")("title", "A")("menu", nullptr))));
  CHECK(backend->sets.size() == 1);
  first.reset();
  auto second = recording(ngn::makeTrayModule(host), events);
  REQUIRE(backend->sets.size() == 2);
  CHECK(backend->sets[1].empty());
}

TEST_CASE("NgNativeDock sets its menu, takes it away, and sends what was chosen") {
  auto backend = std::make_shared<FakeDock>();
  auto host = std::make_shared<DockHost>(backend);
  std::vector<std::string> events;
  auto module = recording(ngn::makeDockModule(host), events);
  module->call(
      "setMenu",
      dynamic::array(dynamic::array(
          dynamic::object("id", "0")("label", "New Note"), dynamic::object("separator", true),
          dynamic::object("id", "2")("label", "Pause")("checked", true))));
  module->call("setMenu", dynamic::array(nullptr));
  REQUIRE(backend->menus.size() == 2);
  REQUIRE(backend->menus[0]);
  CHECK(backend->menus[0]->size() == 3);
  CHECK((*backend->menus[0])[2].checked);
  CHECK_FALSE(backend->menus[1]);

  host->menuSelect("2");
  CHECK(events == std::vector<std::string>{"ngNativeDock {\"id\":\"2\",\"type\":\"menuSelect\"}"});
}

TEST_CASE("a bounce answers an id that cancels it") {
  auto backend = std::make_shared<FakeDock>();
  auto host = std::make_shared<DockHost>(backend);
  auto module = ngn::makeDockModule(host);
  auto first = module->call("bounce", dynamic::array(false));
  auto second = module->call("bounce", dynamic::array(true));
  CHECK(first.asInt() == 1);
  CHECK(second.asInt() == 2);
  module->call("cancelBounce", dynamic::array(first));
  // An id never answered cancels nothing.
  module->call("cancelBounce", dynamic::array(9));
  CHECK(backend->log == std::vector<std::string>{"bounce 1", "bounce 2 critical", "cancel 1"});
}

TEST_CASE("a reloaded app's Dock menu starts empty") {
  auto backend = std::make_shared<FakeDock>();
  auto host = std::make_shared<DockHost>(backend);
  auto first = ngn::makeDockModule(host);
  first->call("setMenu", dynamic::array(dynamic::array(dynamic::object("id", "0")("label", "New"))));
  first.reset();
  auto second = ngn::makeDockModule(host);
  REQUIRE(backend->menus.size() == 2);
  CHECK_FALSE(backend->menus[1]);
}
