// The native controls on GTK (native-controls.h): the widget each one mounts as, its props, the
// events it sends as the user changes it, its commands, and the size it measures at.
#include "mounted-views.h"

#include "../native-controls.h"

#include <adwaita.h>
#include <doctest/doctest.h>

#include <string>
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
  auto withRole = controlProps<Descriptor>(folly::dynamic::object("value", true)("accessibilityRole", "switch")("accessibilityLabel", "Wi-Fi"));
  views.update(view, withRole);
  toggle = controlOf(views, 3);
  CHECK(gtk_accessible_get_accessible_role(GTK_ACCESSIBLE(views.view(3))) == GTK_ACCESSIBLE_ROLE_GENERIC);
  CHECK(gtk_accessible_get_accessible_role(GTK_ACCESSIBLE(toggle)) == GTK_ACCESSIBLE_ROLE_SWITCH);
  gtk_test_accessible_assert_property(toggle, GTK_ACCESSIBLE_PROPERTY_LABEL, "Wi-Fi");
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
  views.backend->dispatchCommand(3, "setValue", folly::dynamic::array(false));
  CHECK_FALSE(gtk_switch_get_active(GTK_SWITCH(toggle)));
  CHECK(events.sent.size() == 1);
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
  GtkWidget *calendar = gtk_popover_get_child(gtk_menu_button_get_popover(GTK_MENU_BUTTON(button)));
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

  // The time modes show the time, with nothing to pick.
  views.update(view, controlProps<Descriptor>(folly::dynamic::object("date", ms)("mode", "time")));
  gchar *time = g_date_time_format(noon, "%X");
  CHECK(std::string(gtk_menu_button_get_label(GTK_MENU_BUTTON(button))) == time);
  CHECK_FALSE(gtk_widget_get_sensitive(button));
  g_free(time);
  for (GDateTime *d : {noon, bound, later, picked, past}) {
    g_date_time_unref(d);
  }
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
