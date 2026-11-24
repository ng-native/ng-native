// The focus on GTK (focus.h): the core's Tab order and composite keys, real GTK focus on each
// view's widget, and focus moved from outside (an assistive technology) heard by the next Tab.
#include "mounted-views.h"

#include "../focus.h"
#include "../menus.h"

#include "ngn/native-controls.h"

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

TEST_CASE("Tab reaches a segmented control between two buttons, in a segment, forwards and backwards") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views(false, 300, 200);
  ngn::gtk::trackFocus(GTK_WINDOW(views.window));
  views.add(view(2, dynamic::object("focusable", true)("role", "button"), {{0, 0}, {50, 20}}));
  views.add(MountedViews::shadow(
      3, "RNCSegmentedControl",
      ngn::testing::parsedProps<ngn::SegmentedControlComponentDescriptor>(dynamic::object("values", dynamic::array("Day", "Week", "Month"))),
      {{0, 30}, {200, 30}}));
  views.add(view(4, dynamic::object("focusable", true)("role", "button"), {{0, 70}, {50, 20}}));
  GtkWidget *segments = ngn::gtk::viewData(views.view(3))->control;
  REQUIRE(segments);
  auto press = [&](guint key, GdkModifierType state = GdkModifierType(0)) {
    return ngn::gtk::moveFocusByKey(GTK_WINDOW(views.window), key, state, *views.backend, views.mounting->tree());
  };
  auto focus = [&] { return gtk_root_get_focus(GTK_ROOT(views.window)); };
  REQUIRE(gtk_widget_grab_focus(views.view(2)));
  CHECK(press(GDK_KEY_Tab));
  CHECK((focus() == segments || gtk_widget_is_ancestor(focus(), segments)));
  CHECK(press(GDK_KEY_Tab));
  CHECK(focus() == views.view(4));
  CHECK(press(GDK_KEY_ISO_Left_Tab, GDK_SHIFT_MASK));
  CHECK((focus() == segments || gtk_widget_is_ancestor(focus(), segments)));
  CHECK(press(GDK_KEY_ISO_Left_Tab, GDK_SHIFT_MASK));
  CHECK(focus() == views.view(2));
}

TEST_CASE("a click on a view's own padding takes the focus from a view inside it, a click on that view does not") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views(false, 300, 200);
  ngn::gtk::trackFocus(GTK_WINDOW(views.window));
  auto outer = view(2, dynamic::object("focusable", true), {{0, 0}, {100, 100}});
  auto inner = view(3, dynamic::object("focusable", true), {{20, 20}, {40, 40}});
  views.add(outer);
  views.add(inner, 2);
  GtkWidget *a = views.view(2);
  GtkWidget *b = views.view(3);
  ngn::testing::runUntil([&] { return gtk_widget_get_width(a) == 100 && gtk_widget_get_width(b) == 40; });
  GtkGesture *click = nullptr;
  GListModel *controllers = gtk_widget_observe_controllers(a);
  for (guint i = 0; i < g_list_model_get_n_items(controllers) && !click; i++) {
    auto *controller = static_cast<GtkEventController *>(g_list_model_get_item(controllers, i));
    if (GTK_IS_GESTURE_CLICK(controller)) {
      click = GTK_GESTURE(controller);
    }
    g_object_unref(controller);
  }
  g_object_unref(controllers);
  REQUIRE(click);
  auto press = [&](double x, double y) { g_signal_emit_by_name(click, "pressed", 1, x, y); };

  REQUIRE(gtk_widget_grab_focus(b));
  // On the inner view, the press that came up to the outer one leaves the focus where it is.
  press(30, 30);
  CHECK(gtk_root_get_focus(GTK_ROOT(views.window)) == b);
  // On the outer view's own padding it is the outer view's.
  press(5, 5);
  CHECK(gtk_root_get_focus(GTK_ROOT(views.window)) == a);
}

TEST_CASE("Tab in an open popover is GTK's, which keeps it in the popover, not the core's, which would leave it") {
  REQUIRE(ngn::testing::gtkReady());
  Views v;
  GtkWidget *popover = gtk_popover_new();
  GtkWidget *box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
  GtkWidget *first = gtk_button_new_with_label("One");
  GtkWidget *second = gtk_button_new_with_label("Two");
  gtk_box_append(GTK_BOX(box), first);
  gtk_box_append(GTK_BOX(box), second);
  gtk_popover_set_child(GTK_POPOVER(popover), box);
  gtk_widget_set_parent(popover, v.views.view(2));
  gtk_popover_popup(GTK_POPOVER(popover));
  ngn::testing::runUntil([&] { return gtk_widget_get_mapped(popover); });
  REQUIRE(gtk_widget_grab_focus(first));
  CHECK_FALSE(v.press(GDK_KEY_Tab));
  CHECK_FALSE(v.press(GDK_KEY_ISO_Left_Tab, GDK_SHIFT_MASK));
  CHECK(gtk_widget_is_ancestor(v.focus(), popover));
  // Closed, Tab is the core's again.
  gtk_popover_popdown(GTK_POPOVER(popover));
  REQUIRE(gtk_widget_grab_focus(v.views.view(2)));
  CHECK(v.press(GDK_KEY_Tab));
  CHECK(v.focus() == v.views.view(3));
  gtk_widget_unparent(popover);
}

namespace {

// A key pressed on `widget` as it reaches the widget's own key controllers, after the window's:
// whether one used it.
bool pressOn(GtkWidget *widget, guint keyval, GdkModifierType state = GdkModifierType(0)) {
  GListModel *controllers = gtk_widget_observe_controllers(widget);
  gboolean handled = FALSE;
  for (guint i = 0; i < g_list_model_get_n_items(controllers) && !handled; ++i) {
    auto *controller = GTK_EVENT_CONTROLLER(g_list_model_get_item(controllers, i));
    if (GTK_IS_EVENT_CONTROLLER_KEY(controller)) {
      g_signal_emit_by_name(controller, "key-pressed", keyval, 0u, state, &handled);
    }
    g_object_unref(controller);
  }
  g_object_unref(controllers);
  return handled;
}

void releaseOn(GtkWidget *widget, guint keyval) {
  GListModel *controllers = gtk_widget_observe_controllers(widget);
  for (guint i = 0; i < g_list_model_get_n_items(controllers); ++i) {
    auto *controller = GTK_EVENT_CONTROLLER(g_list_model_get_item(controllers, i));
    if (GTK_IS_EVENT_CONTROLLER_KEY(controller)) {
      g_signal_emit_by_name(controller, "key-released", keyval, 0u, GdkModifierType(0));
    }
    g_object_unref(controller);
  }
  g_object_unref(controllers);
}

} // namespace

TEST_CASE("Space and Return press the focused view once while held, as on macOS, and a default button takes Return first") {
  REQUIRE(ngn::testing::gtkReady());
  Views v;
  std::vector<Tag> pressed;
  v.views.backend->hooks.activate = [&pressed](SurfaceId, Tag tag) {
    pressed.push_back(tag);
    return true;
  };
  GtkWidget *button = v.views.view(2);
  // Only the view with the focus: not one a press bubbles up to from another.
  CHECK_FALSE(pressOn(button, GDK_KEY_space));
  CHECK(pressed.empty());
  REQUIRE(gtk_widget_grab_focus(button));
  CHECK(pressOn(button, GDK_KEY_space));
  CHECK(pressed == std::vector<Tag>{2});
  // Held down, the key repeats, and presses nothing more until it is released.
  CHECK(pressOn(button, GDK_KEY_space));
  CHECK(pressed.size() == 1);
  releaseOn(button, GDK_KEY_space);
  for (guint key : {GDK_KEY_Return, GDK_KEY_KP_Enter, GDK_KEY_space}) {
    CHECK(pressOn(button, key));
    releaseOn(button, key);
  }
  CHECK(pressed.size() == 4);
  // With Ctrl, Alt or Super held, or another key, it is no press.
  CHECK_FALSE(pressOn(button, GDK_KEY_space, GDK_CONTROL_MASK));
  CHECK_FALSE(pressOn(button, GDK_KEY_Return, GDK_ALT_MASK));
  CHECK_FALSE(pressOn(button, GDK_KEY_a));
  CHECK(pressed.size() == 4);

  // A press that moves the focus away never hears its release: the next one presses again.
  CHECK(pressOn(button, GDK_KEY_space));
  REQUIRE(gtk_widget_grab_focus(v.views.view(3)));
  REQUIRE(gtk_widget_grab_focus(button));
  CHECK(pressOn(button, GDK_KEY_space));
  releaseOn(button, GDK_KEY_space);
  CHECK(pressed.size() == 6);

  // A view the press does not reach leaves the key to the window.
  v.views.backend->hooks.activate = [](SurfaceId, Tag) { return false; };
  CHECK_FALSE(pressOn(button, GDK_KEY_space));
  v.views.backend->hooks.activate = [&pressed](SurfaceId, Tag tag) {
    pressed.push_back(tag);
    return true;
  };

  // A view whose role changes gets a new widget, which Space presses too.
  v.views.update(MountedViews::shadow(2, "View", nullptr, {}), desktopViewProps(dynamic::object("focusable", true)("role", "link")));
  GtkWidget *link = v.views.view(2);
  REQUIRE(link != button);
  REQUIRE(v.focus() == link);
  CHECK(pressOn(link, GDK_KEY_space));
  releaseOn(link, GDK_KEY_space);
  CHECK(pressed.size() == 7);

  // A default button in the window takes Return, and leaves Space to the focused view.
  v.views.add(MountedViews::shadow(
      9, "NgNativeButton",
      ngn::testing::parsedProps<ngn::NativeButtonComponentDescriptor>(dynamic::object("title", "Save")("kind", "default")),
      {{150, 100}, {80, 30}}));
  REQUIRE(ngn::gtk::keyButton(v.window(), false));
  CHECK_FALSE(pressOn(link, GDK_KEY_Return));
  CHECK(pressed.size() == 7);
  CHECK(pressOn(link, GDK_KEY_space));
  CHECK(pressed.size() == 8);
}
