// An input script on GTK (input-replay.h): its steps posted to the X server reach GTK's widgets as
// a person's input does.
#include "mounted-views.h"

#include "../input-replay.h"

#include <doctest/doctest.h>

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
      "wait 200\nmove 150 30\ndown 150 30\nup 150 30\ndown 150 90\nup 150 90\ntype Hi there\nkey left\nkey left\nkey right\n");
  REQUIRE_FALSE(ngn::gtk::inputReplayProblem(window, script));
  bool done = false;
  REQUIRE(ngn::gtk::replayInputScript(window, std::move(script), [&done] { done = true; }));
  ngn::testing::runUntil([&done] { return done; });
  CHECK(done);
  CHECK(std::string(gtk_editable_get_text(GTK_EDITABLE(entry))) == "Hi there");
  // Two to the left and one back to the right, from the end.
  CHECK(gtk_editable_get_position(GTK_EDITABLE(entry)) == 7);
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
  gint64 until = g_get_monotonic_time() + 400 * 1000;
  ngn::testing::runUntil([until] { return g_get_monotonic_time() > until; });
  CHECK_FALSE(done);
  g_object_unref(window);
}
