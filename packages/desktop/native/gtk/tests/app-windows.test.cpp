// The app's windows on GTK (app-windows.h) under the core's WindowHost: the size each saves and
// comes back at, maximised or full screen but never placed, the launch links, raising the app
// again, and the last window closing.
#include "mounted-views.h"

#include "../app-windows.h"

#include "fake-system.h"
#include "ngn/splash-screen.h"

#include <adwaita.h>
#include <doctest/doctest.h>

#include <memory>
#include <string>
#include <thread>

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
  int lastClosed = 0;
  std::shared_ptr<ngn::gtk::GtkWindows> windows = std::make_shared<ngn::gtk::GtkWindows>(
      ngn::gtk::GtkWindows::Hooks{.quit = [this] { ++quits; }, .lastWindowClosed = [this] { ++lastClosed; }}, app,
      ngn::MenuPlacement::PrimaryMenu);
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

TEST_CASE("a window that outlives its owner no longer reports to it") {
  REQUIRE(ngn::testing::gtkReady());
  GtkWidget *kept = nullptr;
  {
    Windows w;
    auto surface = w.open({.key = "main", .title = "Notes"});
    kept = GTK_WIDGET(g_object_ref(w.windows->window(surface)));
  }
  // The owner is gone: nothing of it is left connected to the window someone else still holds.
  guint notify = g_signal_lookup("notify", G_TYPE_OBJECT);
  for (const char *property : {"default-width", "default-height", "maximized", "fullscreened", "is-active", "scale-factor"}) {
    CAPTURE(property);
    CHECK(g_signal_handler_find(kept, GSignalMatchType(G_SIGNAL_MATCH_ID | G_SIGNAL_MATCH_DETAIL), notify, g_quark_from_string(property),
                                nullptr, nullptr, nullptr) == 0);
  }
  g_object_unref(kept);
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

TEST_CASE("a window filling the screen reports the size GTK allocates after the state change, once") {
  REQUIRE(ngn::testing::gtkReady());
  Windows w;
  // No window manager here maximises a window, so the window is said to fill the screen: its size
  // is then the surface's, which GTK allocates after the notify that reports the change.
  w.windows->windowFills = [](GtkWindow *) { return true; };
  w.listen();
  auto surface = w.open({.key = "main", .title = "Notes", .width = 600, .height = 400});
  GtkWindow *window = GTK_WINDOW(w.windows->window(surface));
  settle();
  w.events.clear();
  gtk_window_set_default_size(window, 800, 560);
  settle();
  GtkWidget *content = w.windows->surfaceWidget(surface);
  REQUIRE(gtk_widget_get_width(content) > 0);
  int resizes = 0;
  double reportedWidth = 0, reportedHeight = 0;
  for (const auto &event : w.events) {
    if (event["type"] == "resize") {
      ++resizes;
      reportedWidth = event["width"].asDouble();
      reportedHeight = event["height"].asDouble();
    }
  }
  CHECK(reportedWidth == gtk_widget_get_width(content));
  CHECK(reportedHeight == gtk_widget_get_height(content));
  // The width and height notifies and one allocation, not a report per allocation.
  CHECK(resizes <= 3);
  // The same size allocated again says nothing.
  w.events.clear();
  gtk_widget_queue_resize(content);
  settle();
  CHECK(w.events.empty());
}

TEST_CASE("the user closing the last window is the host's to act on only when no app listens to decide") {
  REQUIRE(ngn::testing::gtkReady());
  Windows w;
  w.listen();
  auto first = w.open({.title = "One"});
  // The app's quitWhenLastWindowCloses decides, and it is listening: the request goes to it.
  gtk_window_close(GTK_WINDOW(w.windows->window(first)));
  settle();
  CHECK(w.lastClosed == 0);
  // The app closing its window, as it does when it agrees, or a reload closing it, quits nothing.
  w.windows->closeWindow(first);
  settle();
  CHECK(w.windows->window(first) == nullptr);
  CHECK(w.lastClosed == 0);
  CHECK(w.quits == 0);

  // A window the core does not track closes at once, but the app still listens, so its
  // quitWhenLastWindowCloses has decided already: the core's lastWindowClosed says no.
  w.windows->openWindow(99, ngn::WindowRequest{.title = "Untracked"}, ngn::WindowPlacement{}, nullptr);
  ngn::testing::runUntil([&w] { return w.windows->window(99) != nullptr; });
  gtk_window_close(GTK_WINDOW(w.windows->window(99)));
  settle();
  CHECK(w.windows->window(99) == nullptr);
  CHECK(w.lastClosed == 0);

  w.listening.reset();
  auto second = w.open({.title = "Two"});
  gtk_window_close(GTK_WINDOW(w.windows->window(second)));
  settle();
  CHECK(w.windows->window(second) == nullptr);
  CHECK(w.lastClosed == 1);
  CHECK(w.quits == 0);
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

TEST_CASE("a window the splash screen holds shows once the app hides it, from any thread, and never once closed") {
  REQUIRE(ngn::testing::gtkReady());
  GtkApplication *app = ngn::gtk::startApplication("dev.ngnative.SplashTest");
  auto system = std::make_shared<ngn::testing::FakeSystem>();
  auto splash = std::make_shared<ngn::SplashGate>();
  REQUIRE(splash->hold());
  auto windows = std::make_shared<ngn::gtk::GtkWindows>(
      ngn::gtk::GtkWindows::Hooks{.whenShown = [&splash](std::function<void()> show) { splash->show([show = std::move(show)] { ngn::gtk::onMainContext(show); }); }},
      app, ngn::MenuPlacement::PrimaryMenu);
  auto host = std::make_shared<WindowHost>(windows, system);
  windows->setHost(host);
  auto open = [&] {
    std::optional<SurfaceId> opened;
    host->open({.title = "Notes"}, [&opened](SurfaceId surface) { opened = surface; });
    ngn::testing::runUntil([&opened] { return opened.has_value(); });
    windows->didMount(*opened);
    return *opened;
  };
  auto kept = open();
  auto closed = open();
  settle();
  CHECK_FALSE(gtk_widget_get_mapped(windows->window(kept)));
  CHECK_FALSE(gtk_widget_get_mapped(windows->window(closed)));
  windows->closeWindow(closed);
  settle();
  // The app hides its splash on the JavaScript thread, or a reload ends the module on another.
  std::thread([&splash] { splash->release(); }).join();
  ngn::testing::runUntil([&] { return gtk_widget_get_mapped(windows->window(kept)); });
  CHECK(gtk_widget_get_mapped(windows->window(kept)));
  CHECK(windows->window(closed) == nullptr);

  // A show the splash lets go after its windows are gone does nothing.
  splash = std::make_shared<ngn::SplashGate>();
  REQUIRE(splash->hold());
  open();
  host.reset();
  windows.reset();
  splash->release();
  settle();
  g_object_unref(app);
}

TEST_CASE("a launch's files become file URLs, and its links stay as they are") {
  REQUIRE(ngn::testing::gtkReady());
  auto urls = ngn::gtk::openUrls({"notes://note/7", "/home/ada/a b.md", "file:///home/ada/c.md"});
  CHECK(urls == std::vector<std::string>{"notes://note/7", "file:///home/ada/a%20b.md", "file:///home/ada/c.md"});
}

TEST_CASE("windows the splash screen holds show in the order they were ready, each in one dispatch, and report the ones that show") {
  REQUIRE(ngn::testing::gtkReady());
  GtkApplication *app = ngn::gtk::startApplication("dev.ngnative.SplashOrderTest");
  auto system = std::make_shared<ngn::testing::FakeSystem>();
  auto splash = std::make_shared<ngn::SplashGate>();
  REQUIRE(splash->hold());
  std::vector<SurfaceId> presented;
  // Whether the window is already on screen when the hook hears of it: the launch's first frame
  // (Expo Updates) counts only for a visible window, and it is counted from this hook once the
  // splash lets the window show, which can be after its last mount.
  std::vector<bool> visibleWhenPresented;
  std::shared_ptr<ngn::gtk::GtkWindows> windows;
  windows = std::make_shared<ngn::gtk::GtkWindows>(
      ngn::gtk::GtkWindows::Hooks{.whenShown = [&splash](std::function<void()> show) { splash->show([show = std::move(show)] { ngn::gtk::onMainContext(show); }); },
                                  .presented =
                                      [&](SurfaceId surface) {
                                        presented.push_back(surface);
                                        visibleWhenPresented.push_back(gtk_widget_get_visible(windows->window(surface)));
                                      }},
      app, ngn::MenuPlacement::PrimaryMenu);
  auto host = std::make_shared<WindowHost>(windows, system);
  windows->setHost(host);
  auto open = [&] {
    std::optional<SurfaceId> opened;
    host->open({.title = "Notes"}, [&opened](SurfaceId surface) { opened = surface; });
    ngn::testing::runUntil([&opened] { return opened.has_value(); });
    windows->didMount(*opened);
    return *opened;
  };
  auto first = open();
  auto closed = open();
  // The app's own window waits on the splash too, queued after these, as the host's does.
  bool firstMappedWhenAppShown = false;
  bool appShown = false;
  splash->show([&] {
    ngn::gtk::onMainContext([&] {
      firstMappedWhenAppShown = gtk_widget_get_mapped(windows->window(first));
      appShown = true;
    });
  });
  windows->closeWindow(closed);
  settle();
  CHECK(presented.empty());
  splash->release();
  ngn::testing::runUntil([&] { return appShown; });
  CHECK(firstMappedWhenAppShown);
  CHECK(presented == std::vector<SurfaceId>{first});
  CHECK(visibleWhenPresented == std::vector<bool>{true});
  windows.reset();
  host.reset();
  g_object_unref(app);
}
