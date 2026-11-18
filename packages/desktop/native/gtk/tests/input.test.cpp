// The GTK side of pointer input: click counts GDK does not give a raw press, the DOM's button bits
// for GDK's buttons, and the CSS cursor names GTK takes.
#include "../surface-input.h"

#include <doctest/doctest.h>

#include <cstring>

using facebook::react::Cursor;
using ngn::gtk::ClickCounter;

TEST_CASE("quick presses close together count up; a slow, far or other-button press starts again") {
  ClickCounter clicks(400, 5);
  CHECK(clicks.press(1000, 10, 10, 1) == 1);
  CHECK(clicks.press(1200, 12, 11, 1) == 2);
  CHECK(clicks.press(1500, 12, 11, 1) == 3);
  // Too slow.
  CHECK(clicks.press(2000, 12, 11, 1) == 1);
  // Too far.
  CHECK(clicks.press(2100, 30, 11, 1) == 1);
  // Another button.
  CHECK(clicks.press(2200, 30, 11, 3) == 1);
}

TEST_CASE("GDK's buttons are the DOM's bits: secondary is 2, middle 4, back and forward 8 and 16") {
  CHECK(ngn::gtk::buttonBit(1) == 1);
  CHECK(ngn::gtk::buttonBit(2) == 4);
  CHECK(ngn::gtk::buttonBit(3) == 2);
  CHECK(ngn::gtk::buttonBit(8) == 8);
  CHECK(ngn::gtk::buttonBit(9) == 16);
  CHECK(ngn::gtk::buttonBit(4) == 0);
}

TEST_CASE("cursors go to GTK by their CSS names, the default as none") {
  CHECK(ngn::gtk::cursorName(Cursor::Auto) == nullptr);
  CHECK(std::strcmp(ngn::gtk::cursorName(Cursor::Pointer), "pointer") == 0);
  CHECK(std::strcmp(ngn::gtk::cursorName(Cursor::Text), "text") == 0);
  CHECK(std::strcmp(ngn::gtk::cursorName(Cursor::NotAllowed), "not-allowed") == 0);
  CHECK(std::strcmp(ngn::gtk::cursorName(Cursor::NWSEResize), "nwse-resize") == 0);
  CHECK(std::strcmp(ngn::gtk::cursorName(Cursor::Url), "pointer") == 0);
}

TEST_CASE("a cursor the theme may not have falls back to the default one") {
  GdkCursor *pointer = ngn::gtk::makeCursor(Cursor::Pointer);
  REQUIRE(pointer);
  CHECK(std::strcmp(gdk_cursor_get_name(pointer), "pointer") == 0);
  GdkCursor *fallback = gdk_cursor_get_fallback(pointer);
  REQUIRE(fallback);
  CHECK(std::strcmp(gdk_cursor_get_name(fallback), "default") == 0);
  g_object_unref(pointer);
  CHECK(ngn::gtk::makeCursor(Cursor::Auto) == nullptr);
}
