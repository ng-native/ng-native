// An input script on GTK (input-replay.h): its steps posted to the X server reach GTK's widgets as
// a person's input does.
#include "mounted-views.h"

#include "../input-replay.h"

#include <doctest/doctest.h>

#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

#include <string>

#ifdef GDK_WINDOWING_X11
#include <gdk/x11/gdkx.h>
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

TEST_CASE("an input script clicks a GTK button, types into a field and moves its cursor, at the window's own points, then says it is done") {
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

  auto script = ngn::parseInputScript(
      "wait 200\nmove 150 30\ndown 150 30\nup 150 30\ndown 150 90\nup 150 90\n"
      "type Hi there, a+b!\nkey left\nkey left\nkey right\n");
  REQUIRE_FALSE(ngn::gtk::inputReplayProblem(window, script));
  bool done = false;
  REQUIRE(ngn::gtk::replayInputScript(window, std::move(script), [&done] { done = true; }));
  ngn::testing::runUntil([&done] { return done; });
  CHECK(done);
  CHECK(std::string(gtk_editable_get_text(GTK_EDITABLE(entry))) == "Hi there, a+b!");
  // Two to the left and one back to the right, from the end.
  CHECK(gtk_editable_get_position(GTK_EDITABLE(entry)) == 13);
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
  bool done = false;
  REQUIRE(ngn::gtk::replayInputScript(window, ngn::parseInputScript("wait 100\nmove 10 10\ndown 10 10\nup 10 10\n"), [&done] { done = true; }));
  gtk_window_destroy(GTK_WINDOW(window));
  // The steps after the wait would go to a window that is gone.
  gint64 until = g_get_monotonic_time() + 400 * 1000;
  ngn::testing::runUntil([until] { return g_get_monotonic_time() > until; });
  CHECK_FALSE(done);
}

TEST_CASE("an input script whose window is destroyed while a caller still holds it stops there") {
  REQUIRE(ngn::testing::gtkReady());
  if (!onX11()) {
    return;
  }
  GtkWidget *window = gtk_window_new();
  gtk_window_set_default_size(GTK_WINDOW(window), 200, 100);
  gtk_window_present(GTK_WINDOW(window));
  ngn::testing::runUntil([window] { return gtk_widget_get_mapped(window); });
  // The caller's own reference keeps the window object alive through its destruction.
  g_object_ref(window);
  bool done = false;
  REQUIRE(ngn::gtk::replayInputScript(window, ngn::parseInputScript("wait 100\n"), [&done] { done = true; }));
  gtk_window_destroy(GTK_WINDOW(window));
  // Unrealized, with no surface, but not finalized: the steps after the wait have nowhere to go.
  CHECK_FALSE(gtk_widget_get_realized(window));
  gint64 until = g_get_monotonic_time() + 400 * 1000;
  ngn::testing::runUntil([until] { return g_get_monotonic_time() > until; });
  CHECK_FALSE(done);
  g_object_unref(window);
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
