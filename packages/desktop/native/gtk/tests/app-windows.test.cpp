// The app's windows on GTK (app-windows.h) under the core's WindowHost: the size each saves and
// comes back at, maximised or full screen but never placed, the launch links, raising the app
// again, and the last window closing.
#include "mounted-views.h"

#include "../app-windows.h"

#include "fake-system.h"

#include <adwaita.h>
#include <doctest/doctest.h>

#include <memory>
#include <string>

namespace {

using ngn::SurfaceId;
using ngn::WindowFrame;
using ngn::WindowHost;

// An application id of its own for each: on a session bus, an application left exported by the
// test before keeps its object path, and another with the same id could not register.
std::string nextAppId() {
  static int made = 0;
  return "dev.ngnative.WindowsTest" + std::to_string(++made);
}

struct Windows {
  GtkApplication *app = ngn::gtk::startApplication(nextAppId());
  std::shared_ptr<ngn::testing::FakeSystem> system = std::make_shared<ngn::testing::FakeSystem>();
  int quits = 0;
  std::shared_ptr<ngn::gtk::GtkWindows> windows = std::make_shared<ngn::gtk::GtkWindows>(
      ngn::gtk::GtkWindows::Hooks{.quit = [this] { ++quits; }}, app, ngn::MenuPlacement::PrimaryMenu);
  std::shared_ptr<WindowHost> host = std::make_shared<WindowHost>(windows, system);
  std::vector<folly::dynamic> events;
  std::shared_ptr<void> listening;

  Windows() {
    windows->setHost(host);
  }
  ~Windows() {
    listening.reset();
    windows.reset();
    host.reset();
    g_object_unref(app);
  }
  // The app's module listening, as a running app's does.
  void listen() {
    listening = host->attach([this](const folly::dynamic &event) { events.push_back(event); });
  }
  // Opens and shows a window as the app's `open` does, once its first frame mounts.
  SurfaceId open(ngn::WindowRequest request) {
    std::optional<SurfaceId> opened;
    host->open(request, [&opened](SurfaceId surface) { opened = surface; });
    ngn::testing::runUntil([&opened] { return opened.has_value(); });
    windows->didMount(*opened);
    ngn::testing::runUntil([this, &opened] { return gtk_widget_get_mapped(windows->window(*opened)); });
    return *opened;
  }
  folly::dynamic saved(const std::string &key) {
    return system->preferences["NgNativeWindowFrame " + key];
  }
};

void settle() {
  for (int i = 0; i < 50; ++i) {
    g_main_context_iteration(nullptr, FALSE);
    g_usleep(1000);
  }
}

} // namespace

TEST_CASE("a window opens at its saved size, and a resize saves the size and no place") {
  REQUIRE(ngn::testing::gtkReady());
  Windows w;
  w.system->preferences["NgNativeWindowFrame main"] = folly::dynamic::object("x", 300)("y", 200)("width", 640)("height", 480);
  auto surface = w.open({.key = "main", .title = "Notes"});
  GtkWindow *window = GTK_WINDOW(w.windows->window(surface));
  int width = 0, height = 0;
  gtk_window_get_default_size(window, &width, &height);
  CHECK(width == 640);
  CHECK(height == 480);

  // The user makes it bigger: saved at the new size, at no place of its own.
  gtk_window_set_default_size(window, 700, 520);
  settle();
  CHECK(w.saved("main") == folly::dynamic::object("x", 0)("y", 0)("width", 700)("height", 520));
}

TEST_CASE("a maximised window saves that with the size it goes back to, and opens maximised again") {
  REQUIRE(ngn::testing::gtkReady());
  {
    Windows w;
    auto surface = w.open({.key = "main", .title = "Notes", .width = 600, .height = 400});
    GtkWindow *window = GTK_WINDOW(w.windows->window(surface));
    gtk_window_maximize(window);
    gint64 deadline = g_get_monotonic_time() + 2 * G_USEC_PER_SEC;
    while (!gtk_window_is_maximized(window) && g_get_monotonic_time() < deadline) {
      g_main_context_iteration(nullptr, FALSE);
      g_usleep(1000);
    }
    if (!gtk_window_is_maximized(window)) {
      MESSAGE("no window manager maximises the window here (Xvfb alone)");
      return;
    }
    settle();
    CHECK(w.saved("main") == folly::dynamic::object("x", 0)("y", 0)("width", 600)("height", 400)("maximized", true));
  }
  Windows again;
  again.system->preferences["NgNativeWindowFrame main"] =
      folly::dynamic::object("x", 0)("y", 0)("width", 600)("height", 400)("maximized", true);
  auto surface = again.open({.key = "main", .title = "Notes"});
  GtkWindow *window = GTK_WINDOW(again.windows->window(surface));
  ngn::testing::runUntil([window] { return gtk_window_is_maximized(window); });
  int width = 0, height = 0;
  gtk_window_get_default_size(window, &width, &height);
  CHECK(width == 600);
}

TEST_CASE("the last window closing quits the app only when no app listens to decide") {
  REQUIRE(ngn::testing::gtkReady());
  Windows w;
  w.listen();
  auto first = w.open({.title = "One"});
  w.windows->closeWindow(first);
  settle();
  // The app's quitWhenLastWindowCloses decides, and it is listening.
  CHECK(w.quits == 0);
  CHECK(w.windows->window(first) == nullptr);

  w.listening.reset();
  auto second = w.open({.title = "Two"});
  w.windows->closeWindow(second);
  settle();
  CHECK(w.quits == 1);
}

TEST_CASE("launching the app again raises its window, or asks the app to reopen one when it has none") {
  REQUIRE(ngn::testing::gtkReady());
  Windows w;
  w.listen();
  w.windows->raise();
  REQUIRE(w.events.size() == 1);
  CHECK(w.events[0]["type"] == "reopen");
  w.open({.title = "Notes"});
  w.events.clear();
  w.windows->raise();
  for (const auto &event : w.events) {
    CHECK(event["type"] != "reopen");
  }
}

TEST_CASE("a launch's files become file URLs, and its links stay as they are") {
  REQUIRE(ngn::testing::gtkReady());
  auto urls = ngn::gtk::openUrls({"notes://note/7", "/home/ada/a b.md", "file:///home/ada/c.md"});
  CHECK(urls == std::vector<std::string>{"notes://note/7", "file:///home/ada/a%20b.md", "file:///home/ada/c.md"});
}
