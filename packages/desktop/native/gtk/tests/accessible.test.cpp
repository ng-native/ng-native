// A view's accessibility through GTK's own: the role GTK makes its widget with, and the label,
// description, level and states it updates as the props change.
#include "mounted-views.h"

#include "../accessible.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using folly::dynamic;
using ngn::testing::desktopViewProps;
using ngn::testing::MountedViews;

namespace {

bool hasProperty(GtkWidget *widget, GtkAccessibleProperty property, const char *value) {
  char *error = gtk_test_accessible_check_property(GTK_ACCESSIBLE(widget), property, value);
  bool ok = error == nullptr;
  if (!ok) {
    MESSAGE(std::string(error));
    g_free(error);
  }
  return ok;
}

} // namespace

TEST_CASE("a view is made with GTK's role for its accessibility role, and a plain one is read through") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("accessibilityRole", "button")("accessible", true)), {{0, 0}, {50, 20}}));
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("role", "heading")("accessible", true)), {{0, 30}, {50, 20}}));
  views.add(MountedViews::shadow(4, "View", desktopViewProps(dynamic::object()), {{0, 60}, {50, 20}}));
  views.add(MountedViews::shadow(5, "View", desktopViewProps(dynamic::object("role", "checkbox")("accessible", true)), {{0, 90}, {50, 20}}));
  CHECK(gtk_accessible_get_accessible_role(GTK_ACCESSIBLE(views.view(2))) == GTK_ACCESSIBLE_ROLE_BUTTON);
  CHECK(gtk_accessible_get_accessible_role(GTK_ACCESSIBLE(views.view(3))) == GTK_ACCESSIBLE_ROLE_HEADING);
  CHECK(gtk_accessible_get_accessible_role(GTK_ACCESSIBLE(views.view(4))) == GTK_ACCESSIBLE_ROLE_GENERIC);
  CHECK(gtk_accessible_get_accessible_role(GTK_ACCESSIBLE(views.view(5))) == GTK_ACCESSIBLE_ROLE_CHECKBOX);
}

TEST_CASE("a view's label and hint follow its props, and go when the props drop them") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto button = MountedViews::shadow(
      2, "View", desktopViewProps(dynamic::object("accessibilityRole", "button")("accessible", true)("accessibilityLabel", "Save")("accessibilityHint", "Saves the note")),
      {{0, 0}, {50, 20}});
  views.add(button);
  CHECK(hasProperty(views.view(2), GTK_ACCESSIBLE_PROPERTY_LABEL, "Save"));
  CHECK(hasProperty(views.view(2), GTK_ACCESSIBLE_PROPERTY_DESCRIPTION, "Saves the note"));

  views.update(button, desktopViewProps(dynamic::object("accessibilityRole", "button")("accessible", true)("accessibilityLabel", "Save as")));
  CHECK(hasProperty(views.view(2), GTK_ACCESSIBLE_PROPERTY_LABEL, "Save as"));
  CHECK_FALSE(gtk_test_accessible_has_property(GTK_ACCESSIBLE(views.view(2)), GTK_ACCESSIBLE_PROPERTY_DESCRIPTION));
}

TEST_CASE("a heading's level and a checkbox's checked and disabled states reach GTK") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("role", "heading")("accessible", true)("accessibilityLevel", 2)), {{0, 0}, {50, 20}}));
  char *level = gtk_test_accessible_check_property(GTK_ACCESSIBLE(views.view(2)), GTK_ACCESSIBLE_PROPERTY_LEVEL, 2);
  CHECK(level == nullptr);
  g_free(level);

  auto box = MountedViews::shadow(
      3, "View", desktopViewProps(dynamic::object("role", "checkbox")("accessible", true)("accessibilityState", dynamic::object("checked", true)("disabled", true))),
      {{0, 30}, {50, 20}});
  views.add(box);
  CHECK(gtk_test_accessible_has_state(GTK_ACCESSIBLE(views.view(3)), GTK_ACCESSIBLE_STATE_CHECKED));
  char *error = gtk_test_accessible_check_state(GTK_ACCESSIBLE(views.view(3)), GTK_ACCESSIBLE_STATE_CHECKED, GTK_ACCESSIBLE_TRISTATE_TRUE);
  CHECK(error == nullptr);
  g_free(error);
  error = gtk_test_accessible_check_state(GTK_ACCESSIBLE(views.view(3)), GTK_ACCESSIBLE_STATE_DISABLED, TRUE);
  CHECK(error == nullptr);
  g_free(error);

  // Not checkable any more: the state goes.
  views.update(box, desktopViewProps(dynamic::object("role", "checkbox")("accessible", true)));
  CHECK_FALSE(gtk_test_accessible_has_state(GTK_ACCESSIBLE(views.view(3)), GTK_ACCESSIBLE_STATE_CHECKED));
}
