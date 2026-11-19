// An input script on GTK (input-replay.h): its steps posted to the X server reach GTK's widgets as
// a person's input does.
#include "mounted-views.h"

#include "../input-replay.h"

#include <doctest/doctest.h>

#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

#include <string>
#include <vector>

#ifdef GDK_WINDOWING_X11
#include <dlfcn.h>
#include <gdk/x11/gdkx.h>
#include <X11/XKBlib.h>
#include <X11/keysym.h>
#endif

namespace {

bool onX11() {
#ifdef GDK_WINDOWING_X11
  return GDK_IS_X11_DISPLAY(gdk_display_get_default());
#else
  return false;
#endif
}

#ifdef GDK_WINDOWING_X11
// A second X server, started without the XTEST extension, and an Xlib connection to it, for as long
// as this lives: no display when Xvfb is not installed. Not a GdkDisplay, as GTK's portals log
// criticals later in the process once a second one has been closed.
struct ServerWithoutXTest {
  GPid pid{0};
  Display *display{nullptr};

  ServerWithoutXTest() {
    const gchar *argv[] = {"Xvfb", "-displayfd", "1", "-extension", "XTEST", "-nolisten", "tcp", nullptr};
    gint out = -1;
    if (!g_spawn_async_with_pipes(nullptr, const_cast<gchar **>(argv), nullptr,
                                  GSpawnFlags(G_SPAWN_SEARCH_PATH | G_SPAWN_DO_NOT_REAP_CHILD | G_SPAWN_STDERR_TO_DEV_NULL),
                                  nullptr, nullptr, &pid, nullptr, &out, nullptr, nullptr)) {
      pid = 0;
      return;
    }
    // Xvfb writes its display's number once it takes connections.
    std::string number;
    char c = 0;
    while (read(out, &c, 1) == 1 && c != '\n') number += c;
    close(out);
    if (!number.empty()) {
      display = XOpenDisplay((":" + number).c_str());
    }
  }

  ~ServerWithoutXTest() {
    if (display) {
      XCloseDisplay(display);
    }
    if (pid) {
      kill(pid, SIGTERM);
      waitpid(pid, nullptr, 0);
      g_spawn_close_pid(pid);
    }
  }
};
#endif

} // namespace

TEST_CASE("an input script clicks a GTK button and types into a field, at the window's own points") {
  REQUIRE(ngn::testing::gtkReady());
  if (!onX11()) {
    MESSAGE("not X11: the script is refused");
    CHECK(ngn::gtk::inputReplayProblem(nullptr, ngn::parseInputScript("wait 10")) == "an input script plays under X11 only");
    return;
  }
  GtkWidget *window = gtk_window_new();
  gtk_window_set_default_size(GTK_WINDOW(window), 300, 120);
  GtkWidget *box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
  GtkWidget *button = gtk_button_new_with_label("Press");
  gtk_widget_set_size_request(button, 300, 60);
  GtkWidget *entry = gtk_entry_new();
  gtk_widget_set_size_request(entry, 300, 60);
  gtk_box_append(GTK_BOX(box), button);
  gtk_box_append(GTK_BOX(box), entry);
  gtk_window_set_child(GTK_WINDOW(window), box);
  int clicks = 0;
  g_signal_connect(button, "clicked", G_CALLBACK(+[](GtkButton *, gpointer data) { ++*static_cast<int *>(data); }), &clicks);
  gtk_window_present(GTK_WINDOW(window));
  ngn::testing::runUntil([window] { return gtk_widget_get_mapped(window) && gtk_widget_get_width(window) > 0; });

  auto script = ngn::parseInputScript("wait 200\nmove 150 30\ndown 150 30\nup 150 30\ndown 150 90\nup 150 90\ntype Hi there, a+b!\n");
  REQUIRE_FALSE(ngn::gtk::inputReplayProblem(window, script));
  REQUIRE(ngn::gtk::replayInputScript(window, std::move(script)));
  ngn::testing::runUntil([entry] { return std::string(gtk_editable_get_text(GTK_EDITABLE(entry))) == "Hi there, a+b!"; });
  CHECK(clicks == 1);
  gtk_window_destroy(GTK_WINDOW(window));
}

TEST_CASE("an input script with AppKit's gestures or a bad line is refused before it plays") {
  CHECK(ngn::gtk::inputReplayProblem(nullptr, ngn::parseInputScript("scroll 10 10 0 5 began")) ==
        "scroll, magnify, rotate and choose are not played on Linux");
  CHECK(ngn::gtk::inputReplayProblem(nullptr, ngn::parseInputScript("choose Copy")) ==
        "scroll, magnify, rotate and choose are not played on Linux");
  auto bad = ngn::parseInputScript("hop 1 2");
  REQUIRE(bad.error);
  CHECK(ngn::gtk::inputReplayProblem(nullptr, bad) == *bad.error);
}

TEST_CASE("an input script whose window closes stops there") {
  REQUIRE(ngn::testing::gtkReady());
  if (!onX11()) {
    return;
  }
  GtkWidget *window = gtk_window_new();
  gtk_window_set_default_size(GTK_WINDOW(window), 200, 100);
  gtk_window_present(GTK_WINDOW(window));
  ngn::testing::runUntil([window] { return gtk_widget_get_mapped(window); });
  REQUIRE(ngn::gtk::replayInputScript(window, ngn::parseInputScript("wait 100\nmove 10 10\ndown 10 10\nup 10 10\n")));
  gtk_window_destroy(GTK_WINDOW(window));
  // The steps after the wait would go to a window that is gone.
  gint64 until = g_get_monotonic_time() + 400 * 1000;
  ngn::testing::runUntil([until] { return g_get_monotonic_time() > until; });
}

TEST_CASE("an input script stops when its window is destroyed while another reference keeps it") {
  REQUIRE(ngn::testing::gtkReady());
  if (!onX11()) {
    return;
  }
  GtkWidget *window = gtk_window_new();
  gtk_window_set_default_size(GTK_WINDOW(window), 200, 100);
  gtk_window_present(GTK_WINDOW(window));
  ngn::testing::runUntil([window] { return gtk_widget_get_mapped(window); });
  g_object_ref(window);
  REQUIRE(ngn::gtk::replayInputScript(window, ngn::parseInputScript("wait 100\nmove 10 10\ndown 10 10\nup 10 10\n")));
  gtk_window_destroy(GTK_WINDOW(window));
  // Unrealized, with no surface, but not finalized: the steps after the wait have nowhere to go.
  CHECK_FALSE(gtk_widget_get_realized(window));
  gint64 until = g_get_monotonic_time() + 400 * 1000;
  ngn::testing::runUntil([until] { return g_get_monotonic_time() > until; });
  g_object_unref(window);
}

#ifdef GDK_WINDOWING_X11
namespace {

Display *testDisplay() {
  return gdk_x11_display_get_xdisplay(gdk_display_get_default());
}

bool primaryPressed() {
  Window root = 0, child = 0;
  int rx = 0, ry = 0, wx = 0, wy = 0;
  unsigned mask = 0;
  XQueryPointer(testDisplay(), DefaultRootWindow(testDisplay()), &root, &child, &rx, &ry, &wx, &wy, &mask);
  return mask & Button1Mask;
}

void waitMilliseconds(int ms) {
  gint64 until = g_get_monotonic_time() + ms * 1000;
  ngn::testing::runUntil([until] { return g_get_monotonic_time() > until; });
}

} // namespace
#endif

TEST_CASE("an input script whose window closes between its down and its up releases the button") {
  REQUIRE(ngn::testing::gtkReady());
  if (!onX11()) {
    return;
  }
#ifdef GDK_WINDOWING_X11
  GtkWidget *window = gtk_window_new();
  gtk_window_set_default_size(GTK_WINDOW(window), 200, 100);
  gtk_window_present(GTK_WINDOW(window));
  ngn::testing::runUntil([window] { return gtk_widget_get_mapped(window); });
  // Released here whatever the replay did, for the tests after this one.
  struct Release {
    ~Release() {
      using Fake = int (*)(Display *, unsigned, Bool, unsigned long);
      void *lib = dlopen("libXtst.so.6", RTLD_NOW | RTLD_LOCAL);
      if (auto fake = lib ? reinterpret_cast<Fake>(dlsym(lib, "XTestFakeButtonEvent")) : nullptr) {
        fake(testDisplay(), 1, False, 0);
        XSync(testDisplay(), False);
      }
    }
  } release;
  REQUIRE(ngn::gtk::replayInputScript(window, ngn::parseInputScript("down 10 10\nwait 300\nup 10 10\n")));
  ngn::testing::runUntil(primaryPressed);
  gtk_window_destroy(GTK_WINDOW(window));
  // The wait ends, the script stops, and nothing will post its up.
  waitMilliseconds(600);
  CHECK_FALSE(primaryPressed());
#endif
}

TEST_CASE("an input script types each character in its own keyboard group, whichever group is active") {
  REQUIRE(ngn::testing::gtkReady());
  if (!onX11()) {
    return;
  }
#ifdef GDK_WINDOWING_X11
  Display *x = testDisplay();
  GdkDisplay *display = gdk_display_get_default();
  // The `a` key types a in the first group and Cyrillic ef in the second, with the second active,
  // as under a us,ru layout switched to ru.
  KeyCode code = XKeysymToKeycode(x, XK_a);
  REQUIRE(code != 0);
  int perKey = 0;
  KeySym *old = XGetKeyboardMapping(x, code, 1, &perKey);
  std::vector<KeySym> saved(old, old + perKey);
  XFree(old);
  XkbStateRec before{};
  XkbGetState(x, XkbUseCoreKbd, &before);
  struct Restore {
    Display *x;
    KeyCode code;
    std::vector<KeySym> &saved;
    unsigned group;
    ~Restore() {
      XkbLockGroup(x, XkbUseCoreKbd, group);
      XChangeKeyboardMapping(x, code, static_cast<int>(saved.size()), saved.data(), 1);
      XSync(x, False);
    }
  } restore{x, code, saved, before.locked_group};
  KeySym twoGroups[] = {XK_a, XK_A, XK_Cyrillic_ef, XK_Cyrillic_EF};
  XChangeKeyboardMapping(x, code, 4, twoGroups, 1);
  XkbLockGroup(x, XkbUseCoreKbd, 1);
  XSync(x, False);
  // GTK has read the new map.
  ngn::testing::runUntil([display] {
    GdkKeymapKey *keys = nullptr;
    int count = 0;
    bool found = gdk_display_map_keyval(display, GDK_KEY_Cyrillic_ef, &keys, &count);
    g_free(keys);
    return found;
  });

  GtkWidget *window = gtk_window_new();
  gtk_window_set_default_size(GTK_WINDOW(window), 300, 60);
  GtkWidget *entry = gtk_entry_new();
  gtk_window_set_child(GTK_WINDOW(window), entry);
  gtk_window_present(GTK_WINDOW(window));
  ngn::testing::runUntil([window] { return gtk_widget_get_mapped(window) && gtk_widget_get_width(window) > 0; });
  REQUIRE(ngn::gtk::replayInputScript(window, ngn::parseInputScript("wait 100\ndown 150 30\nup 150 30\ntype a\xd1\x84" "A\n")));
  ngn::testing::runUntil([entry] { return g_utf8_strlen(gtk_editable_get_text(GTK_EDITABLE(entry)), -1) == 3; });
  CHECK(std::string(gtk_editable_get_text(GTK_EDITABLE(entry))) == "a\xd1\x84" "A");
  // The active group is put back.
  XkbStateRec after{};
  XkbGetState(x, XkbUseCoreKbd, &after);
  CHECK(after.group == 1);
  gtk_window_destroy(GTK_WINDOW(window));
#endif
}

TEST_CASE("an input script is refused on an X server without the XTEST extension") {
  REQUIRE(ngn::testing::gtkReady());
  if (!onX11()) {
    return;
  }
#ifdef GDK_WINDOWING_X11
  ServerWithoutXTest server;
  if (!server.display) {
    MESSAGE("no Xvfb to start a server without XTEST");
    return;
  }
  CHECK(ngn::gtk::xtestProblem(server.display) == "the X server has no XTEST extension");
  // The test's own server has it.
  CHECK_FALSE(ngn::gtk::xtestProblem(gdk_x11_display_get_xdisplay(gdk_display_get_default())));
#endif
}
