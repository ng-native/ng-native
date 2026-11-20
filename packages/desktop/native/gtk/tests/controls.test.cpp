// The native controls on GTK (native-controls.h): the widget each one mounts as, its props, the
// events it sends as the user changes it, its commands, and the size it measures at.
#include "mounted-views.h"

#include "../native-controls.h"

#include <adwaita.h>
#include <doctest/doctest.h>

#include <clocale>
#include <optional>
#include <string>
#include <utility>
#include <vector>

using facebook::react::ShadowView;
using ngn::testing::MountedViews;

namespace {

struct Sent {
  facebook::react::Tag tag;
  std::string name;
  folly::dynamic payload;
};

// The controls' events while it lives, and the emitters' again after.
struct Events {
  std::vector<Sent> sent;
  Events() {
    ngn::gtk::setControlEventSink([this](facebook::react::Tag tag, const std::string &name, const folly::dynamic &payload) {
      sent.push_back({tag, name, payload});
    });
  }
  ~Events() {
    ngn::gtk::setControlEventSink(nullptr);
  }
};

template <typename Descriptor>
facebook::react::Props::Shared controlProps(folly::dynamic raw) {
  return ngn::testing::parsedProps<Descriptor>(std::move(raw));
}

ShadowView control(facebook::react::Tag tag, const char *component, facebook::react::Props::Shared props) {
  return MountedViews::shadow(tag, component, std::move(props), {{10, 10}, {160, 40}});
}

GtkWidget *controlOf(MountedViews &views, facebook::react::Tag tag) {
  auto *d = ngn::gtk::viewData(views.view(tag));
  return d ? d->control : nullptr;
}

GtkWidget *nthOf(GtkWidget *root, GType type, int &nth) {
  for (GtkWidget *child = gtk_widget_get_first_child(root); child; child = gtk_widget_get_next_sibling(child)) {
    if (G_TYPE_CHECK_INSTANCE_TYPE(child, type) && nth-- == 0) {
      return child;
    }
    if (GtkWidget *found = nthOf(child, type, nth)) {
      return found;
    }
  }
  return nullptr;
}

// The `nth` widget of `type` in a date picker's popover, depth first.
GtkWidget *pickerPart(GtkWidget *button, GType type, int nth = 0) {
  return nthOf(GTK_WIDGET(gtk_menu_button_get_popover(GTK_MENU_BUTTON(button))), type, nth);
}

double localMs(int year, int month, int day, int hour, int minute) {
  GDateTime *at = g_date_time_new_local(year, month, day, hour, minute, 0);
  double ms = static_cast<double>(g_date_time_to_unix(at)) * 1000;
  g_date_time_unref(at);
  return ms;
}

// LC_TIME set for a test, and put back after it.
struct TimeLocale {
  std::string was;
  explicit TimeLocale(const char *name) : was(setlocale(LC_TIME, nullptr)) {
    REQUIRE(setlocale(LC_TIME, name));
  }
  ~TimeLocale() {
    setlocale(LC_TIME, was.c_str());
  }
  TimeLocale(const TimeLocale &) = delete;
  TimeLocale &operator=(const TimeLocale &) = delete;
};

} // namespace

TEST_CASE("a native button is a GtkButton with its title, styled by its kind, and presses send buttonPress") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::NativeButtonComponentDescriptor;
  Events events;
  MountedViews views(false, 200, 100);
  auto view = control(2, "NgNativeButton", controlProps<Descriptor>(folly::dynamic::object("title", "Save")("kind", "default")));
  views.add(view);
  GtkWidget *button = controlOf(views, 2);
  REQUIRE(button);
  REQUIRE(GTK_IS_BUTTON(button));
  CHECK(gtk_widget_get_parent(button) == views.view(2));
  CHECK(std::string(gtk_button_get_label(GTK_BUTTON(button))) == "Save");
  CHECK(gtk_widget_has_css_class(button, "suggested-action"));
  // It fills its view, its CSS box and all.
  graphene_rect_t bounds;
  REQUIRE(gtk_widget_compute_bounds(button, views.view(2), &bounds));
  CHECK(bounds.origin.x == doctest::Approx(0));
  CHECK(bounds.origin.y == doctest::Approx(0));
  CHECK(bounds.size.width == doctest::Approx(160));
  CHECK(bounds.size.height == doctest::Approx(40));

  g_signal_emit_by_name(button, "clicked");
  REQUIRE(events.sent.size() == 1);
  CHECK(events.sent[0].tag == 2);
  CHECK(events.sent[0].name == "buttonPress");

  views.update(view, controlProps<Descriptor>(folly::dynamic::object("title", "Delete")("kind", "destructive")("enabled", false)));
  CHECK(std::string(gtk_button_get_label(GTK_BUTTON(button))) == "Delete");
  CHECK_FALSE(gtk_widget_has_css_class(button, "suggested-action"));
  CHECK(gtk_widget_has_css_class(button, "destructive-action"));
  CHECK_FALSE(gtk_widget_get_sensitive(button));
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("title", "More")("kind", "plain")));
  CHECK(gtk_widget_has_css_class(button, "flat"));
  CHECK_FALSE(gtk_widget_has_css_class(button, "destructive-action"));
  CHECK(gtk_widget_get_sensitive(button));
  // No kind: a plain push button, as on macOS, not the window's suggested action.
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("title", "Add a Star")));
  CHECK_FALSE(gtk_widget_has_css_class(button, "suggested-action"));
  CHECK_FALSE(gtk_widget_has_css_class(button, "flat"));
}

TEST_CASE("a switch is a GtkSwitch: the user's change is sent, and the app's value and commands are not") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::SwitchControlComponentDescriptor;
  Events events;
  MountedViews views(false, 200, 100);
  auto view = control(3, "Switch", controlProps<Descriptor>(folly::dynamic::object("value", true)));
  views.add(view);
  GtkWidget *toggle = controlOf(views, 3);
  REQUIRE(GTK_IS_SWITCH(toggle));
  CHECK(gtk_switch_get_active(GTK_SWITCH(toggle)));
  // One switch to assistive technology: the GtkSwitch, not the view around it, though the element
  // names its role.
  auto withRole = controlProps<Descriptor>(
      folly::dynamic::object("value", true)("accessibilityRole", "switch")("accessibilityLabel", "Wi-Fi")("accessibilityHint", "Joins known networks"));
  views.update(view, withRole);
  toggle = controlOf(views, 3);
  CHECK(gtk_accessible_get_accessible_role(GTK_ACCESSIBLE(views.view(3))) == GTK_ACCESSIBLE_ROLE_GENERIC);
  CHECK(gtk_accessible_get_accessible_role(GTK_ACCESSIBLE(toggle)) == GTK_ACCESSIBLE_ROLE_SWITCH);
  gtk_test_accessible_assert_property(toggle, GTK_ACCESSIBLE_PROPERTY_LABEL, "Wi-Fi");
  gtk_test_accessible_assert_property(toggle, GTK_ACCESSIBLE_PROPERTY_DESCRIPTION, "Joins known networks");
  CHECK(events.sent.empty());

  // The user turns it off.
  // As a click does: the switch moves over, then takes its new state.
  gtk_widget_activate(toggle);
  ngn::testing::runUntil([toggle] { return !gtk_switch_get_active(GTK_SWITCH(toggle)); });
  REQUIRE(events.sent.size() == 1);
  CHECK(events.sent[0].name == "change");
  CHECK(events.sent[0].payload["value"] == false);
  CHECK(events.sent[0].payload["target"] == 3);

  // The app's value, and its setValue command, change it without an event.
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("value", true)));
  CHECK(gtk_switch_get_active(GTK_SWITCH(toggle)));
  // Its label and hint go with the app's.
  CHECK_FALSE(gtk_test_accessible_has_property(GTK_ACCESSIBLE(toggle), GTK_ACCESSIBLE_PROPERTY_LABEL));
  CHECK_FALSE(gtk_test_accessible_has_property(GTK_ACCESSIBLE(toggle), GTK_ACCESSIBLE_PROPERTY_DESCRIPTION));
  views.backend->dispatchCommand(3, "setValue", folly::dynamic::array(false));
  CHECK_FALSE(gtk_switch_get_active(GTK_SWITCH(toggle)));
  CHECK(events.sent.size() == 1);
}

TEST_CASE("a switch keeps the slide a click started through an update to another prop") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::SwitchControlComponentDescriptor;
  // GTK's animations on while the test runs, as on a desktop, and the setting's own again after.
  struct Animations {
    GtkSettings *settings = gtk_settings_get_default();
    gboolean was = TRUE;
    Animations() {
      g_object_get(settings, "gtk-enable-animations", &was, nullptr);
      g_object_set(settings, "gtk-enable-animations", TRUE, nullptr);
    }
    ~Animations() {
      g_object_set(settings, "gtk-enable-animations", was, nullptr);
    }
  } animations;
  Events events;
  MountedViews views(false, 200, 100);
  auto view = control(3, "Switch", controlProps<Descriptor>(folly::dynamic::object("value", false)));
  views.add(view);
  GtkWidget *toggle = controlOf(views, 3);
  REQUIRE(GTK_IS_SWITCH(toggle));
  gtk_widget_activate(toggle);
  REQUIRE_FALSE(gtk_switch_get_active(GTK_SWITCH(toggle)));

  // The app's same value, with a new label, while the switch slides: not MountedViews::update,
  // whose two frames could outlast the slide.
  auto current = views.mounting->tree().find(3)->view;
  auto next = current;
  next.props = controlProps<Descriptor>(folly::dynamic::object("value", false)("accessibilityLabel", "Wi-Fi"));
  views.mounting->executeMount(
      MountedViews::kSurface,
      facebook::react::MountingTransaction(
          MountedViews::kSurface, 1, {facebook::react::ShadowViewMutation::UpdateMutation(current, next, MountedViews::kSurface)}, {}));
  auto applied = std::make_shared<bool>(false);
  views.backend->runOnUiThread([applied] { *applied = true; });
  ngn::testing::runUntil([applied] { return *applied; });
  REQUIRE_FALSE(gtk_switch_get_active(GTK_SWITCH(toggle)));
  gtk_test_accessible_assert_property(toggle, GTK_ACCESSIBLE_PROPERTY_LABEL, "Wi-Fi");

  ngn::testing::runUntil([toggle] { return gtk_switch_get_active(GTK_SWITCH(toggle)); });
  REQUIRE(events.sent.size() == 1);
  CHECK(events.sent[0].payload["value"] == true);
}

TEST_CASE("an activity indicator spins while animating, hides when stopped unless asked not to, and takes its colour") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::ActivityIndicatorControlComponentDescriptor;
  MountedViews views(false, 200, 100);
  auto view = control(4, "ActivityIndicatorView", controlProps<Descriptor>(folly::dynamic::object("animating", true)("color", 0xff3b6ef5)));
  views.add(view);
  GtkWidget *spinner = controlOf(views, 4);
  REQUIRE(spinner);
  CHECK(gtk_widget_get_visible(spinner));
  CHECK(gtk_widget_has_css_class(spinner, ngn::gtk::colorClass("color", facebook::react::colorFromRGBA(0x3b, 0x6e, 0xf5, 0xff)).c_str()));
  if (ngn::gtk::haveAdwSpinner()) {
    CHECK(std::string(G_OBJECT_TYPE_NAME(spinner)) == "AdwSpinner");
  } else {
    REQUIRE(GTK_IS_SPINNER(spinner));
    CHECK(gtk_spinner_get_spinning(GTK_SPINNER(spinner)));
  }

  views.update(view, controlProps<Descriptor>(folly::dynamic::object("animating", false)));
  spinner = controlOf(views, 4);
  CHECK_FALSE(gtk_widget_get_visible(spinner));

  // Shown while stopped: a GtkSpinner that does not spin, whichever libadwaita this is.
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("animating", false)("hidesWhenStopped", false)));
  spinner = controlOf(views, 4);
  REQUIRE(GTK_IS_SPINNER(spinner));
  CHECK(gtk_widget_get_parent(spinner) == views.view(4));
  CHECK(gtk_widget_get_visible(spinner));
  CHECK_FALSE(gtk_spinner_get_spinning(GTK_SPINNER(spinner)));
  // Its colour went with the indicator it replaced.
  CHECK_FALSE(gtk_widget_has_css_class(spinner, ngn::gtk::colorClass("color", facebook::react::colorFromRGBA(0x3b, 0x6e, 0xf5, 0xff)).c_str()));

  ngn::gtk::GtkControlMeasurer measurer;
  ngn::NativeControlProps large;
  large.size = "large";
  CHECK(measurer.measure(ngn::ControlKind::ActivityIndicator, large) == facebook::react::Size{32, 32});
  CHECK(measurer.measure(ngn::ControlKind::ActivityIndicator, {}) == facebook::react::Size{16, 16});
}

TEST_CASE("a stopped activity indicator that stays shown draws its icon") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::ActivityIndicatorControlComponentDescriptor;
  MountedViews views(false, 200, 100);
  views.add(control(4, "ActivityIndicatorView", controlProps<Descriptor>(folly::dynamic::object("animating", false)("hidesWhenStopped", false))));
  GtkWidget *spinner = controlOf(views, 4);
  REQUIRE(GTK_IS_SPINNER(spinner));
  REQUIRE(gtk_widget_get_visible(spinner));
  // The pixels it draws, not GTK's flag alone: Adwaita's stylesheet makes a stopped spinner
  // transparent, which leaves GTK no node to render and no texture.
  REQUIRE(gtk_widget_get_width(spinner) > 0);
  int drawn = 0;
  if (GdkTexture *texture = ngn::gtk::renderWidget(spinner)) {
    int width = gdk_texture_get_width(texture);
    int height = gdk_texture_get_height(texture);
    std::vector<guchar> data(static_cast<size_t>(width) * height * 4);
    gdk_texture_download(texture, data.data(), static_cast<size_t>(width) * 4);
    g_object_unref(texture);
    for (size_t i = 3; i < data.size(); i += 4) {
      drawn += data[i] > 0;
    }
  }
  CHECK(drawn > 0);
}

TEST_CASE("a segmented control shows its segments and selection, and sends the segment the user picks") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::SegmentedControlComponentDescriptor;
  Events events;
  MountedViews views(false, 300, 100);
  auto view = control(5, "RNCSegmentedControl",
      controlProps<Descriptor>(folly::dynamic::object("values", folly::dynamic::array("Day", "Week", "Month"))("selectedIndex", 1)));
  views.add(view);
  GtkWidget *segments = controlOf(views, 5);
  REQUIRE(segments);
  if (ngn::gtk::haveAdwToggleGroup()) {
    MESSAGE("AdwToggleGroup");
    guint active = 0;
    g_object_get(segments, "active", &active, nullptr);
    CHECK(active == 1);
    g_object_set(segments, "active", 2u, nullptr);
  } else {
    MESSAGE("a linked row of toggle buttons");
    CHECK(gtk_widget_has_css_class(segments, "linked"));
    std::vector<GtkWidget *> buttons;
    for (GtkWidget *b = gtk_widget_get_first_child(segments); b; b = gtk_widget_get_next_sibling(b)) {
      buttons.push_back(b);
    }
    REQUIRE(buttons.size() == 3);
    CHECK(std::string(gtk_button_get_label(GTK_BUTTON(buttons[2]))) == "Month");
    CHECK(gtk_toggle_button_get_active(GTK_TOGGLE_BUTTON(buttons[1])));
    CHECK_FALSE(gtk_toggle_button_get_active(GTK_TOGGLE_BUTTON(buttons[0])));
    CHECK(events.sent.empty());
    gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(buttons[2]), TRUE);
  }
  REQUIRE(events.sent.size() == 1);
  CHECK(events.sent[0].name == "change");
  CHECK(events.sent[0].payload["value"] == "Month");
  CHECK(events.sent[0].payload["selectedSegmentIndex"] == 2);

  // New segments replace the old ones, and the app's selection sends nothing.
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("values", folly::dynamic::array("A", "B"))("selectedIndex", 0)));
  CHECK(events.sent.size() == 1);
  if (!ngn::gtk::haveAdwToggleGroup()) {
    int count = 0;
    for (GtkWidget *b = gtk_widget_get_first_child(segments); b; b = gtk_widget_get_next_sibling(b)) {
      ++count;
    }
    CHECK(count == 2);
  }
  // Wider with three long segments than with two short ones.
  ngn::gtk::GtkControlMeasurer measurer;
  ngn::NativeControlProps two, three;
  two.values = {"A", "B"};
  three.values = {"Yesterday", "Today", "Tomorrow"};
  CHECK(measurer.measure(ngn::ControlKind::SegmentedControl, three).width > measurer.measure(ngn::ControlKind::SegmentedControl, two).width);
}

TEST_CASE("a search field sends each change with its count, its submit and cancel, and takes JavaScript's text") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::SearchFieldComponentDescriptor;
  Events events;
  MountedViews views(false, 300, 100);
  auto view = control(6, "ViewManagerAdapter_NgNativeSearchField", controlProps<Descriptor>(folly::dynamic::object("placeholder", "Search notes")));
  views.add(view);
  GtkWidget *entry = controlOf(views, 6);
  REQUIRE(GTK_IS_SEARCH_ENTRY(entry));
  CHECK(std::string(gtk_search_entry_get_placeholder_text(GTK_SEARCH_ENTRY(entry))) == "Search notes");

  gtk_editable_set_text(GTK_EDITABLE(entry), "ap");
  REQUIRE(events.sent.size() == 1);
  CHECK(events.sent[0].name == "changeText");
  CHECK(events.sent[0].payload["text"] == "ap");
  CHECK(events.sent[0].payload["eventCount"] == 1);

  // A text JavaScript sent before that change is not applied over it; one that has seen it is.
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("text", "")("mostRecentEventCount", 0)));
  CHECK(std::string(gtk_editable_get_text(GTK_EDITABLE(entry))) == "ap");
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("text", "apple")("mostRecentEventCount", 1)));
  CHECK(std::string(gtk_editable_get_text(GTK_EDITABLE(entry))) == "apple");
  CHECK(events.sent.size() == 1);

  g_signal_emit_by_name(entry, "activate");
  CHECK(events.sent.back().name == "submitSearch");
  CHECK(events.sent.back().payload["text"] == "apple");
  g_signal_emit_by_name(entry, "stop-search");
  CHECK(std::string(gtk_editable_get_text(GTK_EDITABLE(entry))).empty());
  CHECK(events.sent.back().name == "pressCancel");

  // The clear icon empties the field and cancels too, as AppKit's clear button does: the click
  // reaches every gesture on the icon, GTK's own among them.
  gtk_editable_set_text(GTK_EDITABLE(entry), "pear");
  GtkWidget *icon = nullptr;
  for (GtkWidget *child = gtk_widget_get_first_child(entry); child; child = gtk_widget_get_next_sibling(child)) {
    if (GTK_IS_IMAGE(child) && g_strcmp0(gtk_image_get_icon_name(GTK_IMAGE(child)), "edit-clear-symbolic") == 0) {
      icon = child;
    }
  }
  REQUIRE(icon);
  size_t before = events.sent.size();
  GListModel *controllers = gtk_widget_observe_controllers(icon);
  for (guint i = 0; i < g_list_model_get_n_items(controllers); ++i) {
    gpointer controller = g_list_model_get_item(controllers, i);
    if (GTK_IS_GESTURE_CLICK(controller)) {
      g_signal_emit_by_name(controller, "released", 1, 4.0, 4.0);
    }
    g_object_unref(controller);
  }
  g_object_unref(controllers);
  CHECK(std::string(gtk_editable_get_text(GTK_EDITABLE(entry))).empty());
  REQUIRE(events.sent.size() == before + 2);
  CHECK(events.sent[before].name == "changeText");
  CHECK(events.sent[before].payload["text"] == "");
  CHECK(events.sent[before + 1].name == "pressCancel");
}

TEST_CASE("a search field's blur takes the focus from it alone, not from another field") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::SearchFieldComponentDescriptor;
  MountedViews views(false, 300, 120);
  views.add(control(6, "ViewManagerAdapter_NgNativeSearchField", controlProps<Descriptor>(folly::dynamic::object())));
  views.add(MountedViews::shadow(8, "ViewManagerAdapter_NgNativeSearchField", controlProps<Descriptor>(folly::dynamic::object()), {{10, 60}, {160, 40}}));
  GtkWidget *first = controlOf(views, 6);
  GtkWidget *second = controlOf(views, 8);
  GtkRoot *root = gtk_widget_get_root(first);

  views.backend->dispatchCommand(8, "focus", folly::dynamic::array());
  GtkWidget *focus = gtk_root_get_focus(root);
  REQUIRE(focus);
  REQUIRE(gtk_widget_is_ancestor(focus, second));
  views.backend->dispatchCommand(6, "blur", folly::dynamic::array());
  CHECK(gtk_root_get_focus(root) == focus);

  views.backend->dispatchCommand(8, "blur", folly::dynamic::array());
  CHECK(gtk_root_get_focus(root) == nullptr);
}

TEST_CASE("a date picker shows its date and picks a day in a calendar, keeping the time of day and its bounds") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::DatePickerComponentDescriptor;
  Events events;
  MountedViews views(false, 300, 100);
  GDateTime *noon = g_date_time_new_local(2026, 3, 14, 12, 30, 0);
  double ms = static_cast<double>(g_date_time_to_unix(noon)) * 1000;
  GDateTime *bound = g_date_time_new_local(2026, 3, 20, 0, 0, 0);
  double max = static_cast<double>(g_date_time_to_unix(bound)) * 1000;
  auto view = control(7, "RNDateTimePicker", controlProps<Descriptor>(folly::dynamic::object("date", ms)("maximumDate", max)("mode", "date")));
  views.add(view);
  GtkWidget *button = controlOf(views, 7);
  REQUIRE(GTK_IS_MENU_BUTTON(button));
  gchar *expected = g_date_time_format(noon, "%x");
  CHECK(std::string(gtk_menu_button_get_label(GTK_MENU_BUTTON(button))) == expected);
  g_free(expected);
  GtkWidget *calendar = pickerPart(button, GTK_TYPE_CALENDAR);
  REQUIRE(GTK_IS_CALENDAR(calendar));
  CHECK(events.sent.empty());

  GDateTime *later = g_date_time_new_local(2026, 3, 16, 0, 0, 0);
  gtk_calendar_select_day(GTK_CALENDAR(calendar), later);
  REQUIRE(events.sent.size() == 1);
  CHECK(events.sent[0].name == "change");
  GDateTime *picked = g_date_time_new_from_unix_local(static_cast<gint64>(events.sent[0].payload["timestamp"].asDouble() / 1000));
  CHECK(g_date_time_get_day_of_month(picked) == 16);
  CHECK(g_date_time_get_hour(picked) == 12);
  CHECK(g_date_time_get_minute(picked) == 30);
  CHECK(events.sent[0].payload["utcOffset"].asDouble() == doctest::Approx(g_date_time_get_utc_offset(picked) / G_TIME_SPAN_MINUTE));

  // A day past the maximum is the maximum.
  GDateTime *past = g_date_time_new_local(2026, 3, 25, 0, 0, 0);
  gtk_calendar_select_day(GTK_CALENDAR(calendar), past);
  CHECK(events.sent.back().payload["timestamp"].asDouble() == doctest::Approx(max));

  // The time mode shows the time and picks it, and so does a countdown.
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("date", ms)("mode", "time")));
  gchar *time = g_date_time_format(noon, "%X");
  CHECK(std::string(gtk_menu_button_get_label(GTK_MENU_BUTTON(button))) == time);
  CHECK(gtk_widget_get_sensitive(button));
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("date", ms)("mode", "countdown")));
  CHECK(gtk_widget_get_sensitive(button));
  g_free(time);
  for (GDateTime *d : {noon, bound, later, picked, past}) {
    g_date_time_unref(d);
  }
}

TEST_CASE("a time picker picks an hour and a minute on its day, on the locale's 24-hour clock, within its bounds") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::DatePickerComponentDescriptor;
  TimeLocale locale("C");
  Events events;
  MountedViews views(false, 300, 100);
  double ms = localMs(2026, 3, 14, 12, 30);
  double min = localMs(2026, 3, 14, 9, 0), max = localMs(2026, 3, 14, 18, 0);
  auto view = control(7, "RNDateTimePicker", controlProps<Descriptor>(folly::dynamic::object("date", ms)("minimumDate", min)("maximumDate", max)("mode", "time")));
  views.add(view);
  GtkWidget *button = controlOf(views, 7);
  REQUIRE(button);
  GtkWidget *hours = pickerPart(button, GTK_TYPE_SPIN_BUTTON, 0);
  GtkWidget *minutes = pickerPart(button, GTK_TYPE_SPIN_BUTTON, 1);
  REQUIRE(hours);
  REQUIRE(minutes);
  CHECK_FALSE(gtk_widget_get_visible(pickerPart(button, GTK_TYPE_CALENDAR)));
  CHECK(gtk_widget_get_visible(gtk_widget_get_parent(hours)));
  CHECK_FALSE(gtk_widget_get_visible(gtk_widget_get_last_child(gtk_widget_get_parent(hours))));
  CHECK(gtk_spin_button_get_value_as_int(GTK_SPIN_BUTTON(hours)) == 12);
  CHECK(gtk_spin_button_get_value_as_int(GTK_SPIN_BUTTON(minutes)) == 30);
  CHECK(events.sent.empty());

  gtk_spin_button_set_value(GTK_SPIN_BUTTON(hours), 15);
  REQUIRE(events.sent.size() == 1);
  CHECK(events.sent[0].name == "change");
  CHECK(events.sent[0].payload["timestamp"].asDouble() == doctest::Approx(localMs(2026, 3, 14, 15, 30)));
  gtk_spin_button_set_value(GTK_SPIN_BUTTON(minutes), 5);
  CHECK(events.sent.back().payload["timestamp"].asDouble() == doctest::Approx(localMs(2026, 3, 14, 15, 5)));

  // Past the maximum is the maximum, and the spin buttons show it.
  gtk_spin_button_set_value(GTK_SPIN_BUTTON(hours), 20);
  CHECK(events.sent.back().payload["timestamp"].asDouble() == doctest::Approx(max));
  CHECK(gtk_spin_button_get_value_as_int(GTK_SPIN_BUTTON(hours)) == 18);
  CHECK(gtk_spin_button_get_value_as_int(GTK_SPIN_BUTTON(minutes)) == 0);
  gtk_spin_button_set_value(GTK_SPIN_BUTTON(hours), 3);
  CHECK(events.sent.back().payload["timestamp"].asDouble() == doctest::Approx(min));

  // The app's new date shows without being sent back.
  size_t sent = events.sent.size();
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("date", localMs(2026, 3, 14, 10, 45))("mode", "time")));
  CHECK(gtk_spin_button_get_value_as_int(GTK_SPIN_BUTTON(hours)) == 10);
  CHECK(gtk_spin_button_get_value_as_int(GTK_SPIN_BUTTON(minutes)) == 45);
  CHECK(events.sent.size() == sent);

  // A date and time picker shows the calendar and the time together.
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("date", ms)("mode", "datetime")));
  CHECK(gtk_widget_get_visible(pickerPart(button, GTK_TYPE_CALENDAR)));
  CHECK(gtk_widget_get_visible(gtk_widget_get_parent(hours)));
}

TEST_CASE("on a locale's 12-hour clock a time picker's hour runs 1 to 12 beside AM and PM") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::DatePickerComponentDescriptor;
  TimeLocale locale("en_US.UTF-8");
  Events events;
  MountedViews views(false, 300, 100);
  auto view = control(7, "RNDateTimePicker", controlProps<Descriptor>(folly::dynamic::object("date", localMs(2026, 3, 14, 12, 30))("mode", "time")));
  views.add(view);
  GtkWidget *button = controlOf(views, 7);
  GtkWidget *hours = pickerPart(button, GTK_TYPE_SPIN_BUTTON, 0);
  GtkWidget *meridiem = hours ? gtk_widget_get_last_child(gtk_widget_get_parent(hours)) : nullptr;
  REQUIRE(hours);
  REQUIRE(meridiem);
  double lowest = 0, highest = 0;
  gtk_spin_button_get_range(GTK_SPIN_BUTTON(hours), &lowest, &highest);
  CHECK(lowest == 1);
  CHECK(highest == 12);
  CHECK(gtk_widget_get_visible(meridiem));
  CHECK(gtk_spin_button_get_value_as_int(GTK_SPIN_BUTTON(hours)) == 12);
  CHECK(std::string(gtk_button_get_label(GTK_BUTTON(meridiem))) == "PM");

  gtk_spin_button_set_value(GTK_SPIN_BUTTON(hours), 3);
  REQUIRE_FALSE(events.sent.empty());
  CHECK(events.sent.back().payload["timestamp"].asDouble() == doctest::Approx(localMs(2026, 3, 14, 15, 30)));
  g_signal_emit_by_name(meridiem, "clicked");
  CHECK(events.sent.back().payload["timestamp"].asDouble() == doctest::Approx(localMs(2026, 3, 14, 3, 30)));
  CHECK(std::string(gtk_button_get_label(GTK_BUTTON(meridiem))) == "AM");
}

TEST_CASE("a time picker's minutes step by minuteInterval, and a time between two steps shows the one before") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::DatePickerComponentDescriptor;
  TimeLocale locale("C");
  Events events;
  MountedViews views(false, 300, 100);
  auto props = [](int interval) {
    return controlProps<Descriptor>(folly::dynamic::object("date", localMs(2026, 3, 14, 12, 37))("mode", "time")("minuteInterval", interval));
  };
  auto view = control(7, "RNDateTimePicker", props(15));
  views.add(view);
  GtkWidget *minutes = pickerPart(controlOf(views, 7), GTK_TYPE_SPIN_BUTTON, 1);
  REQUIRE(minutes);
  double lowest = 0, highest = 0, step = 0, page = 0;
  gtk_spin_button_get_range(GTK_SPIN_BUTTON(minutes), &lowest, &highest);
  gtk_spin_button_get_increments(GTK_SPIN_BUTTON(minutes), &step, &page);
  CHECK(lowest == 0);
  CHECK(highest == 45);
  CHECK(step == 15);
  CHECK(gtk_spin_button_get_value_as_int(GTK_SPIN_BUTTON(minutes)) == 30);
  CHECK(events.sent.empty());
  gtk_spin_button_spin(GTK_SPIN_BUTTON(minutes), GTK_SPIN_STEP_FORWARD, 0);
  REQUIRE_FALSE(events.sent.empty());
  CHECK(events.sent.back().payload["timestamp"].asDouble() == doctest::Approx(localMs(2026, 3, 14, 12, 45)));
  // A minute set between two steps snaps to one.
  size_t before = events.sent.size();
  gtk_spin_button_set_value(GTK_SPIN_BUTTON(minutes), 20);
  REQUIRE(events.sent.size() > before);
  for (size_t i = before; i < events.sent.size(); i++) {
    CAPTURE(i);
    CHECK(events.sent[i].payload["timestamp"].asDouble() == doctest::Approx(localMs(2026, 3, 14, 12, 15)));
  }
  // A minute already on a step is sent as it is.
  gtk_spin_button_set_value(GTK_SPIN_BUTTON(minutes), 45);
  CHECK(events.sent.back().payload["timestamp"].asDouble() == doctest::Approx(localMs(2026, 3, 14, 12, 45)));
  // The app's time shows at the step before it, not the nearest.
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("date", localMs(2026, 3, 14, 12, 44))("mode", "time")("minuteInterval", 15)));
  CHECK(gtk_spin_button_get_value_as_int(GTK_SPIN_BUTTON(minutes)) == 30);

  // One that does not divide the hour is 1, as UIDatePicker takes it.
  views.update(view, props(7));
  gtk_spin_button_get_range(GTK_SPIN_BUTTON(minutes), &lowest, &highest);
  CHECK(highest == 59);
  CHECK(gtk_spin_button_get_value_as_int(GTK_SPIN_BUTTON(minutes)) == 37);
}

TEST_CASE("a time picker's bounds and minute step resolve together, and the spin buttons show what was sent") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::DatePickerComponentDescriptor;
  TimeLocale locale("C");
  Events events;
  MountedViews views(false, 300, 100);
  auto view = control(
      7, "RNDateTimePicker",
      controlProps<Descriptor>(folly::dynamic::object("date", localMs(2026, 3, 14, 11, 0))("minimumDate", localMs(2026, 3, 14, 10, 37))("mode", "time")("minuteInterval", 15)));
  views.add(view);
  GtkWidget *hours = pickerPart(controlOf(views, 7), GTK_TYPE_SPIN_BUTTON, 0);
  GtkWidget *minutes = pickerPart(controlOf(views, 7), GTK_TYPE_SPIN_BUTTON, 1);
  REQUIRE(hours);
  REQUIRE(minutes);
  // 10:30 is on the step but before the minimum, and 10:37 is off it: the first time that is both is 10:45.
  gtk_spin_button_set_value(GTK_SPIN_BUTTON(hours), 10);
  gtk_spin_button_set_value(GTK_SPIN_BUTTON(minutes), 30);
  CHECK(events.sent.back().payload["timestamp"].asDouble() == doctest::Approx(localMs(2026, 3, 14, 10, 45)));
  CHECK(gtk_spin_button_get_value_as_int(GTK_SPIN_BUTTON(hours)) == 10);
  CHECK(gtk_spin_button_get_value_as_int(GTK_SPIN_BUTTON(minutes)) == 45);
}

TEST_CASE("a day chosen in the calendar is the one an hour chosen next is on, before the app's props arrive") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::DatePickerComponentDescriptor;
  TimeLocale locale("C");
  Events events;
  MountedViews views(false, 300, 100);
  auto view = control(7, "RNDateTimePicker", controlProps<Descriptor>(folly::dynamic::object("date", localMs(2026, 11, 19, 9, 30))("mode", "datetime")));
  views.add(view);
  GtkWidget *button = controlOf(views, 7);
  GtkWidget *calendar = pickerPart(button, GTK_TYPE_CALENDAR);
  GtkWidget *hours = pickerPart(button, GTK_TYPE_SPIN_BUTTON, 0);
  REQUIRE(calendar);
  REQUIRE(hours);
  GDateTime *day = g_date_time_new_local(2026, 11, 20, 0, 0, 0);
  gtk_calendar_select_day(GTK_CALENDAR(calendar), day);
  g_date_time_unref(day);
  CHECK(events.sent.back().payload["timestamp"].asDouble() == doctest::Approx(localMs(2026, 11, 20, 9, 30)));
  gtk_spin_button_set_value(GTK_SPIN_BUTTON(hours), 14);
  CHECK(events.sent.back().payload["timestamp"].asDouble() == doctest::Approx(localMs(2026, 11, 20, 14, 30)));
  // Props that arrive are the app's again.
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("date", localMs(2026, 11, 22, 9, 30))("mode", "datetime")));
  gtk_spin_button_set_value(GTK_SPIN_BUTTON(hours), 10);
  CHECK(events.sent.back().payload["timestamp"].asDouble() == doctest::Approx(localMs(2026, 11, 22, 10, 30)));
}

TEST_CASE("a 12-hour clock's AM and PM button is labelled where the locale writes neither") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::DatePickerComponentDescriptor;
  // The German locale has no AM or PM strings.
  TimeLocale locale("de_DE.UTF-8");
  MountedViews views(false, 300, 100);
  ngn::gtk::useClockFormat(true);
  auto view = control(7, "RNDateTimePicker", controlProps<Descriptor>(folly::dynamic::object("date", localMs(2026, 3, 14, 15, 30))("mode", "time")));
  views.add(view);
  GtkWidget *hours = pickerPart(controlOf(views, 7), GTK_TYPE_SPIN_BUTTON, 0);
  REQUIRE(hours);
  GtkWidget *meridiem = gtk_widget_get_last_child(gtk_widget_get_parent(hours));
  CHECK(std::string(gtk_button_get_label(GTK_BUTTON(meridiem))) == "PM");
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("date", localMs(2026, 3, 14, 9, 30))("mode", "time")));
  CHECK(std::string(gtk_button_get_label(GTK_BUTTON(meridiem))) == "AM");
  ngn::gtk::useClockFormat(std::nullopt);
}

TEST_CASE("a countdown picks hours and minutes on a 24-hour clock, with no AM and PM") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::DatePickerComponentDescriptor;
  TimeLocale locale("en_US.UTF-8");
  Events events;
  MountedViews views(false, 300, 100);
  auto view = control(7, "RNDateTimePicker", controlProps<Descriptor>(folly::dynamic::object("date", localMs(2026, 3, 14, 1, 30))("mode", "countdown")));
  views.add(view);
  GtkWidget *button = controlOf(views, 7);
  GtkWidget *hours = pickerPart(button, GTK_TYPE_SPIN_BUTTON, 0);
  REQUIRE(hours);
  CHECK(gtk_widget_get_sensitive(button));
  CHECK(gtk_widget_get_visible(gtk_widget_get_parent(hours)));
  CHECK_FALSE(gtk_widget_get_visible(pickerPart(button, GTK_TYPE_CALENDAR)));
  CHECK_FALSE(gtk_widget_get_visible(gtk_widget_get_last_child(gtk_widget_get_parent(hours))));
  double lowest = 0, highest = 0;
  gtk_spin_button_get_range(GTK_SPIN_BUTTON(hours), &lowest, &highest);
  CHECK(lowest == 0);
  CHECK(highest == 23);
  CHECK(std::string(gtk_editable_get_text(GTK_EDITABLE(hours))) == "01");
  CHECK(std::string(gtk_menu_button_get_label(GTK_MENU_BUTTON(button))) == "01:30");
  gtk_spin_button_set_value(GTK_SPIN_BUTTON(hours), 2);
  REQUIRE_FALSE(events.sent.empty());
  CHECK(events.sent.back().payload["timestamp"].asDouble() == doctest::Approx(localMs(2026, 3, 14, 2, 30)));
}

TEST_CASE("a time picker follows the desktop's clock format over the locale's, as it changes, and the locale's again without one") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::DatePickerComponentDescriptor;
  TimeLocale locale("C");
  Events events;
  MountedViews views(false, 300, 100);
  auto view = control(7, "RNDateTimePicker", controlProps<Descriptor>(folly::dynamic::object("date", localMs(2026, 3, 14, 15, 30))("mode", "time")));
  views.add(view);
  GtkWidget *hours = pickerPart(controlOf(views, 7), GTK_TYPE_SPIN_BUTTON, 0);
  REQUIRE(hours);
  GtkWidget *meridiem = gtk_widget_get_last_child(gtk_widget_get_parent(hours));
  auto highest = [hours] {
    double lowest = 0, high = 0;
    gtk_spin_button_get_range(GTK_SPIN_BUTTON(hours), &lowest, &high);
    return high;
  };
  CHECK(highest() == 23);
  CHECK(std::string(gtk_editable_get_text(GTK_EDITABLE(hours))) == "15");

  // GNOME's clock-format says 12h, over C's 24-hour clock: the picker shown changes.
  ngn::gtk::useClockFormat(true);
  CHECK(highest() == 12);
  CHECK(gtk_widget_get_visible(meridiem));
  CHECK(gtk_spin_button_get_value_as_int(GTK_SPIN_BUTTON(hours)) == 3);
  CHECK(std::string(gtk_editable_get_text(GTK_EDITABLE(hours))) == "3");
  CHECK(std::string(gtk_menu_button_get_label(GTK_MENU_BUTTON(controlOf(views, 7)))) == "3:30:00 PM");
  CHECK(events.sent.empty());
  gtk_spin_button_set_value(GTK_SPIN_BUTTON(hours), 4);
  CHECK(events.sent.back().payload["timestamp"].asDouble() == doctest::Approx(localMs(2026, 3, 14, 16, 30)));

  ngn::gtk::useClockFormat(false);
  CHECK(highest() == 23);
  CHECK(std::string(gtk_menu_button_get_label(GTK_MENU_BUTTON(controlOf(views, 7)))) == "15:30:00");
  CHECK_FALSE(gtk_widget_get_visible(meridiem));
  ngn::gtk::useClockFormat(std::nullopt);
  {
    TimeLocale twelve("en_US.UTF-8");
    // A picker made now reads the locale's 12-hour clock.
    auto other = control(8, "RNDateTimePicker", controlProps<Descriptor>(folly::dynamic::object("date", localMs(2026, 3, 14, 15, 30))("mode", "time")));
    views.add(other);
    GtkWidget *otherHours = pickerPart(controlOf(views, 8), GTK_TYPE_SPIN_BUTTON, 0);
    double lowest = 0, high = 0;
    gtk_spin_button_get_range(GTK_SPIN_BUTTON(otherHours), &lowest, &high);
    CHECK(high == 12);
  }
}

TEST_CASE("a date picker sends the offset of the day it sends, when a bound moves it across a daylight-saving change") {
  REQUIRE(ngn::testing::gtkReady());
  // London's time zone while the test runs, and the run's own again after.
  struct LondonTime {
    std::optional<std::string> was;
    LondonTime() {
      if (const char *tz = g_getenv("TZ")) {
        was = tz;
      }
      g_setenv("TZ", "Europe/London", TRUE);
    }
    ~LondonTime() {
      if (was) {
        g_setenv("TZ", was->c_str(), TRUE);
      } else {
        g_unsetenv("TZ");
      }
    }
  } london;
  using Descriptor = ngn::DatePickerComponentDescriptor;
  Events events;
  MountedViews views(false, 300, 100);
  // Winter time on the date, summer time from the minimum on.
  GDateTime *winter = g_date_time_new_local(2026, 3, 14, 12, 30, 0);
  GDateTime *summer = g_date_time_new_local(2026, 4, 2, 9, 0, 0);
  REQUIRE(g_date_time_get_utc_offset(winter) == 0);
  REQUIRE(g_date_time_get_utc_offset(summer) == 60 * G_TIME_SPAN_MINUTE);
  double min = static_cast<double>(g_date_time_to_unix(summer)) * 1000;
  auto view = control(7, "RNDateTimePicker", controlProps<Descriptor>(folly::dynamic::object("date", static_cast<double>(g_date_time_to_unix(winter)) * 1000)("minimumDate", min)("mode", "date")));
  views.add(view);
  GtkWidget *calendar = pickerPart(controlOf(views, 7), GTK_TYPE_CALENDAR);
  GDateTime *before = g_date_time_new_local(2026, 3, 20, 0, 0, 0);
  gtk_calendar_select_day(GTK_CALENDAR(calendar), before);
  REQUIRE(events.sent.size() == 1);
  CHECK(events.sent[0].payload["timestamp"].asDouble() == doctest::Approx(min));
  CHECK(events.sent[0].payload["utcOffset"].asDouble() == doctest::Approx(60));
  for (GDateTime *d : {winter, summer, before}) {
    g_date_time_unref(d);
  }
}

TEST_CASE("a date picker keeps the month the user browses to through an update to another prop") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::DatePickerComponentDescriptor;
  MountedViews views(false, 300, 100);
  GDateTime *noon = g_date_time_new_local(2026, 3, 14, 12, 30, 0);
  double ms = static_cast<double>(g_date_time_to_unix(noon)) * 1000;
  g_date_time_unref(noon);
  auto view = control(7, "RNDateTimePicker", controlProps<Descriptor>(folly::dynamic::object("date", ms)("mode", "date")));
  views.add(view);
  GtkWidget *calendar = pickerPart(controlOf(views, 7), GTK_TYPE_CALENDAR);
  REQUIRE(GTK_IS_CALENDAR(calendar));
  auto month = [calendar] {
    GDateTime *at = gtk_calendar_get_date(GTK_CALENDAR(calendar));
    int m = g_date_time_get_month(at);
    g_date_time_unref(at);
    return m;
  };
  REQUIRE(month() == 3);
  // The user browses with the calendar's first arrow (the previous month's) to another month.
  std::vector<GtkWidget *> pending{calendar};
  GtkWidget *arrow = nullptr;
  while (!pending.empty() && !arrow) {
    GtkWidget *w = pending.front();
    pending.erase(pending.begin());
    if (w != calendar && GTK_IS_BUTTON(w)) {
      arrow = w;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(w); child; child = gtk_widget_get_next_sibling(child)) {
      pending.push_back(child);
    }
  }
  REQUIRE(arrow);
  g_signal_emit_by_name(arrow, "clicked");
  int browsed = month();
  REQUIRE(browsed != 3);

  views.update(view, controlProps<Descriptor>(folly::dynamic::object("date", ms)("mode", "date")("accessibilityHint", "Due date")));
  CHECK(month() == browsed);
  // A new date from the app shows its month.
  GDateTime *june = g_date_time_new_local(2026, 6, 1, 12, 0, 0);
  double juneMs = static_cast<double>(g_date_time_to_unix(june)) * 1000;
  g_date_time_unref(june);
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("date", juneMs)("mode", "date")));
  CHECK(month() == 6);
  // The same date taken away and given back, after the user browsed away again, shows its month.
  g_signal_emit_by_name(arrow, "clicked");
  REQUIRE(month() != 6);
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("mode", "date")));
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("date", juneMs)("mode", "date")));
  CHECK(month() == 6);
}

TEST_CASE("a date picker shows the bound it sends for a day picked past it, when the app keeps its date") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::DatePickerComponentDescriptor;
  Events events;
  MountedViews views(false, 300, 100);
  GDateTime *noon = g_date_time_new_local(2026, 3, 14, 12, 30, 0);
  double ms = static_cast<double>(g_date_time_to_unix(noon)) * 1000;
  g_date_time_unref(noon);
  auto props = [ms] { return controlProps<Descriptor>(folly::dynamic::object("date", ms)("maximumDate", ms)("mode", "date")); };
  auto view = control(7, "RNDateTimePicker", props());
  views.add(view);
  GtkWidget *calendar = pickerPart(controlOf(views, 7), GTK_TYPE_CALENDAR);
  REQUIRE(GTK_IS_CALENDAR(calendar));
  auto shown = [calendar] {
    GDateTime *at = gtk_calendar_get_date(GTK_CALENDAR(calendar));
    std::pair<int, int> day{g_date_time_get_month(at), g_date_time_get_day_of_month(at)};
    g_date_time_unref(at);
    return day;
  };
  GDateTime *past = g_date_time_new_local(2026, 4, 16, 0, 0, 0);
  gtk_calendar_select_day(GTK_CALENDAR(calendar), past);
  g_date_time_unref(past);
  REQUIRE(events.sent.size() == 1);
  CHECK(events.sent[0].payload["timestamp"].asDouble() == doctest::Approx(ms));
  // The app takes the bound, its date already: nothing else moves the calendar back.
  views.update(view, props());
  CHECK(shown() == std::pair{3, 14});
  CHECK(events.sent.size() == 1);
}

TEST_CASE("a date picker holding a date GLib cannot represent sends a picked day at its start, without GLib criticals") {
  REQUIRE(ngn::testing::gtkReady());
  using Descriptor = ngn::DatePickerComponentDescriptor;
  Events events;
  MountedViews views(false, 300, 100);
  // In the year 33658, past GLib's 9999.
  views.add(control(7, "RNDateTimePicker", controlProps<Descriptor>(folly::dynamic::object("date", 1e15)("mode", "date"))));
  GtkWidget *calendar = pickerPart(controlOf(views, 7), GTK_TYPE_CALENDAR);
  int criticals = 0;
  // Removed on every exit path: the handler holds &criticals.
  struct Handler {
    guint id;
    ~Handler() {
      g_log_remove_handler("GLib", id);
    }
  } handler{g_log_set_handler("GLib", G_LOG_LEVEL_CRITICAL, [](const gchar *, GLogLevelFlags, const gchar *, gpointer count) {
    ++*static_cast<int *>(count);
  }, &criticals)};
  GDateTime *day = g_date_time_new_local(2026, 3, 16, 0, 0, 0);
  double start = static_cast<double>(g_date_time_to_unix(day)) * 1000;
  gtk_calendar_select_day(GTK_CALENDAR(calendar), day);
  g_date_time_unref(day);
  REQUIRE(events.sent.size() == 1);
  CHECK(events.sent[0].payload["timestamp"].asDouble() == doctest::Approx(start));
  CHECK(criticals == 0);
}

TEST_CASE("the controls measure as GTK lays them out") {
  REQUIRE(ngn::testing::gtkReady());
  ngn::gtk::GtkControlMeasurer measurer;
  ngn::NativeControlProps shortTitle, longTitle;
  shortTitle.title = "OK";
  longTitle.title = "Open a Window with a Transparent Title Bar";
  auto small = measurer.measure(ngn::ControlKind::Button, shortTitle);
  auto large = measurer.measure(ngn::ControlKind::Button, longTitle);
  CHECK(small.width > 20);
  CHECK(small.height >= 24);
  CHECK(large.width > small.width + 100);
  CHECK(large.height == small.height);
  auto toggle = measurer.measure(ngn::ControlKind::Switch, {});
  CHECK(toggle.width > toggle.height);
  CHECK(toggle.height >= 20);
}
