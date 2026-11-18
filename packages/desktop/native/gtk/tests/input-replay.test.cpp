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

  auto script = ngn::parseInputScript("wait 200\nmove 150 30\ndown 150 30\nup 150 30\ndown 150 90\nup 150 90\ntype Hi there\n");
  REQUIRE_FALSE(ngn::gtk::inputReplayProblem(window, script));
  REQUIRE(ngn::gtk::replayInputScript(window, std::move(script)));
  ngn::testing::runUntil([entry] { return std::string(gtk_editable_get_text(GTK_EDITABLE(entry))) == "Hi there"; });
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
