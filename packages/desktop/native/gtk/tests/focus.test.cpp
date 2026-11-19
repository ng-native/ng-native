// The focus on GTK (focus.h): the core's Tab order and composite keys, real GTK focus on each
// view's widget, and focus moved from outside (an assistive technology) heard by the next Tab.
#include "mounted-views.h"

#include "../focus.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using folly::dynamic;
using ngn::testing::desktopViewProps;
using ngn::testing::MountedViews;

namespace {

ShadowView view(Tag tag, dynamic props, Rect frame) {
  return MountedViews::shadow(tag, "View", desktopViewProps(std::move(props)), frame);
}

// Two focusable buttons (2, 3), a plain view (4), a view left out of Tab order (5), and a tablist
// (6) of two tabs (7, 8).
struct Views {
  MountedViews views{false, 300, 200};
  Views() {
    auto tab = [](const char *label) {
      return dynamic::object("role", "tab")("focusable", true)("accessibilityLabel", label);
    };
    std::vector<ShadowView> made{
        view(2, dynamic::object("focusable", true)("role", "button"), {{0, 0}, {50, 20}}),
        view(3, dynamic::object("tabIndex", 0)("role", "button"), {{0, 30}, {50, 20}}),
        view(4, dynamic::object(), {{0, 60}, {50, 20}}),
        view(5, dynamic::object("tabIndex", -1), {{0, 90}, {50, 20}}),
        view(6, dynamic::object("role", "tablist"), {{100, 0}, {120, 20}}),
        view(7, tab("One"), {{0, 0}, {60, 20}}),
        view(8, tab("Two"), {{60, 0}, {60, 20}}),
    };
    ShadowViewMutationList mutations;
    for (const auto &v : made) {
      mutations.push_back(ShadowViewMutation::CreateMutation(v));
    }
    for (int i = 0; i < 5; i++) {
      mutations.push_back(ShadowViewMutation::InsertMutation(MountedViews::kSurface, made[static_cast<size_t>(i)], i));
    }
    mutations.push_back(ShadowViewMutation::InsertMutation(6, made[5], 0));
    mutations.push_back(ShadowViewMutation::InsertMutation(6, made[6], 1));
    views.mount(std::move(mutations));
    ngn::gtk::trackFocus(GTK_WINDOW(views.window));
  }
  GtkWindow *window() {
    return GTK_WINDOW(views.window);
  }
  bool press(guint keyval, GdkModifierType state = GdkModifierType(0)) {
    return ngn::gtk::moveFocusByKey(window(), keyval, state, *views.backend, views.mounting->tree());
  }
  GtkWidget *focus() {
    return gtk_root_get_focus(GTK_ROOT(views.window));
  }
};

} // namespace

TEST_CASE("a view's widget takes the focus as its desktop props say") {
  REQUIRE(ngn::testing::gtkReady());
  Views v;
  CHECK(gtk_widget_get_focusable(v.views.view(2)));
  CHECK(gtk_widget_get_focusable(v.views.view(3)));
  CHECK_FALSE(gtk_widget_get_focusable(v.views.view(4)));
  // Any tabIndex takes the focus when it is moved there, though -1 is out of Tab order.
  CHECK(gtk_widget_get_focusable(v.views.view(5)));
  // And it follows the props.
  v.views.update(MountedViews::shadow(2, "View", nullptr, {}), desktopViewProps(dynamic::object("focusable", false)));
  CHECK_FALSE(gtk_widget_get_focusable(v.views.view(2)));
}

TEST_CASE("Tab and Shift-Tab walk the core's Tab order with real GTK focus, a tablist one stop") {
  REQUIRE(ngn::testing::gtkReady());
  Views v;
  CHECK(v.press(GDK_KEY_Tab));
  CHECK(v.focus() == v.views.view(2));
  CHECK(v.press(GDK_KEY_Tab));
  CHECK(v.focus() == v.views.view(3));
  // The view with the focus is marked for its ring, and the one it left is not.
  CHECK(gtk_widget_has_css_class(v.views.view(3), "ngn-focused"));
  CHECK_FALSE(gtk_widget_has_css_class(v.views.view(2), "ngn-focused"));
  // The tablist is one stop: its first tab.
  CHECK(v.press(GDK_KEY_Tab));
  CHECK(v.focus() == v.views.view(7));
  // Wrapping round, past the plain view and the one out of Tab order.
  CHECK(v.press(GDK_KEY_Tab));
  CHECK(v.focus() == v.views.view(2));
  // Shift-Tab arrives as ISO_Left_Tab.
  CHECK(v.press(GDK_KEY_ISO_Left_Tab, GDK_SHIFT_MASK));
  CHECK(v.focus() == v.views.view(7));
  // Ctrl+Tab is not the focus's.
  CHECK_FALSE(v.press(GDK_KEY_Tab, GDK_CONTROL_MASK));
}

TEST_CASE("arrow keys move inside a composite widget, and focus moved from outside is where Tab goes on from") {
  REQUIRE(ngn::testing::gtkReady());
  Views v;
  REQUIRE(gtk_widget_grab_focus(v.views.view(7)));
  CHECK(v.press(GDK_KEY_Right));
  CHECK(v.focus() == v.views.view(8));
  // A tablist wraps.
  CHECK(v.press(GDK_KEY_Right));
  CHECK(v.focus() == v.views.view(7));
  // Out of a composite, an arrow is not the focus's to use.
  REQUIRE(gtk_widget_grab_focus(v.views.view(2)));
  CHECK_FALSE(v.press(GDK_KEY_Right));
  // An assistive technology focusing the second button: Tab goes on from there.
  REQUIRE(gtk_widget_grab_focus(v.views.view(3)));
  CHECK(v.press(GDK_KEY_Tab));
  CHECK(v.focus() == v.views.view(7));
}

TEST_CASE("Tab stays in the container the focus is in") {
  REQUIRE(ngn::testing::gtkReady());
  Views v;
  // The tablist as a container of its own (as a sheet's or a pane's root is): Tab cycles inside it.
  v.views.mounting->tree().addContainerRoot(6);
  REQUIRE(gtk_widget_grab_focus(v.views.view(7)));
  CHECK(v.press(GDK_KEY_Tab));
  CHECK(v.focus() == v.views.view(7));
  v.views.mounting->tree().removeContainerRoot(6);
  CHECK(v.press(GDK_KEY_Tab));
  CHECK(v.focus() == v.views.view(2));
}
