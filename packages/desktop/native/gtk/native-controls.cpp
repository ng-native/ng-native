#include "native-controls.h"

#include "screens.h"

#include <react/renderer/core/RawEvent.h>

#include <dlfcn.h>

#include <algorithm>
#include <cmath>
#include <optional>

using facebook::react::RawEvent;

namespace ngn::gtk {

// A view's control: the widget filling it and what it was last given.
struct Control {
  ControlKind kind;
  GtkWidget *widget{nullptr};
  ViewData *view{nullptr};
  // Set while the backend changes the control, so it sends nothing JavaScript already knows.
  bool applying{false};
  // A search field's changes, which a text from JavaScript must have seen.
  int eventCount{0};
  // The segments the control holds, and the class its colour came from.
  std::vector<std::string> values;
  std::string colorClass;
  // An activity indicator drawn by AdwSpinner, which has no stopped state.
  bool adwSpinner{false};
  // A date picker's calendar, and the app's date it last showed: the month the user browses to
  // stays until the app's date changes.
  GtkWidget *calendar{nullptr};
  std::optional<double> date;
};

namespace {

const NativeControlProps *controlProps(const ViewData &view) {
  return dynamic_cast<const NativeControlProps *>(view.props.get());
}

Control *controlOf(GtkWidget *widget) {
  return static_cast<Control *>(g_object_get_data(G_OBJECT(widget), "ngn-control"));
}

ControlEventSink &eventSink() {
  static ControlEventSink sink;
  return sink;
}

void send(Control *c, const std::string &name, folly::dynamic payload) {
  if (c && c->view && eventSink()) {
    eventSink()(c->view->tag, name, payload);
  } else if (c && c->view && c->view->emitter) {
    c->view->emitter->dispatchEvent(name, std::move(payload), RawEvent::Category::Discrete);
  }
}

void setClass(GtkWidget *widget, const char *name, bool on) {
  if (on) {
    gtk_widget_add_css_class(widget, name);
  } else {
    gtk_widget_remove_css_class(widget, name);
  }
}

// --- Button -----------------------------------------------------------------------------------

void configureButton(GtkWidget *button, const NativeControlProps &p) {
  gtk_button_set_label(GTK_BUTTON(button), p.title.c_str());
  setClass(button, "suggested-action", p.kind == "default");
  setClass(button, "destructive-action", p.kind == "destructive");
  setClass(button, "flat", p.kind == "plain");
  // The window's Return and Escape find it by this (menus.h's keyButton).
  g_object_set_data(G_OBJECT(button), "ngn-key-role", const_cast<char *>(p.kind == "default" ? "default" : p.kind == "cancel" ? "cancel" : nullptr));
}

// --- Activity indicator -----------------------------------------------------------------------

int spinnerSize(const NativeControlProps &p) {
  return p.size == "large" ? 32 : 16;
}

// AdwSpinner turns for as long as it shows, so one that stays shown while stopped is a GtkSpinner.
bool wantsAdwSpinner(const NativeControlProps &p) {
  return haveAdwSpinner() && p.hidesWhenStopped;
}

// Adwaita's stylesheet makes a stopped GtkSpinner transparent. Ours is shown stopped only when
// asked to stay, so it draws its icon, still.
void installStoppedSpinnerStyle() {
  static bool installed = false;
  if (installed || !gdk_display_get_default()) {
    return;
  }
  installed = true;
  GtkCssProvider *css = gtk_css_provider_new();
  gtk_css_provider_load_from_data(css, "spinner.ngn-spinner:not(:checked) { opacity: 1; }", -1);
  gtk_style_context_add_provider_for_display(gdk_display_get_default(), GTK_STYLE_PROVIDER(css), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
  g_object_unref(css);
}

GtkWidget *makeSpinner(bool adw) {
  GtkWidget *spinner = adw ? adwFunction<GtkWidget *(*)()>("adw_spinner_new")() : gtk_spinner_new();
  if (!adw) {
    installStoppedSpinnerStyle();
    gtk_widget_add_css_class(spinner, "ngn-spinner");
  }
  gtk_widget_set_halign(spinner, GTK_ALIGN_CENTER);
  gtk_widget_set_valign(spinner, GTK_ALIGN_CENTER);
  return spinner;
}

// --- Segmented control ------------------------------------------------------------------------

constexpr guint kNoSegment = GTK_INVALID_LIST_POSITION;

using ToggleGroupNew = GtkWidget *(*)();
using ToggleNew = GObject *(*)();
using ToggleSetLabel = void (*)(GObject *, const char *);
using ToggleGroupAdd = void (*)(GtkWidget *, GObject *);
using ToggleGroupRemoveAll = void (*)(GtkWidget *);
using ToggleGroupSetActive = void (*)(GtkWidget *, guint);
using ToggleGroupGetActive = guint (*)(GtkWidget *);

void segmentChosen(Control *c, guint index) {
  if (c->applying || index == kNoSegment || index >= c->values.size()) {
    return;
  }
  send(c, "change", folly::dynamic::object("value", c->values[index])("selectedSegmentIndex", static_cast<int>(index)));
  const auto *p = controlProps(*c->view);
  if (p && p->momentary) {
    // A momentary control shows no choice once pressed.
    c->applying = true;
    if (haveAdwToggleGroup()) {
      adwFunction<ToggleGroupSetActive>("adw_toggle_group_set_active")(c->widget, kNoSegment);
    } else {
      for (GtkWidget *b = gtk_widget_get_first_child(c->widget); b; b = gtk_widget_get_next_sibling(b)) {
        gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(b), FALSE);
      }
    }
    c->applying = false;
  }
}

GtkWidget *makeSegments() {
  if (haveAdwToggleGroup()) {
    return adwFunction<ToggleGroupNew>("adw_toggle_group_new")();
  }
  GtkWidget *box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
  gtk_widget_add_css_class(box, "linked");
  return box;
}

void fillSegments(Control *c, GtkWidget *segments, const std::vector<std::string> &values) {
  if (haveAdwToggleGroup()) {
    adwFunction<ToggleGroupRemoveAll>("adw_toggle_group_remove_all")(segments);
    for (const auto &value : values) {
      GObject *toggle = adwFunction<ToggleNew>("adw_toggle_new")();
      adwFunction<ToggleSetLabel>("adw_toggle_set_label")(toggle, value.c_str());
      adwFunction<ToggleGroupAdd>("adw_toggle_group_add")(segments, toggle);
    }
    return;
  }
  while (GtkWidget *b = gtk_widget_get_first_child(segments)) {
    gtk_box_remove(GTK_BOX(segments), b);
  }
  GtkWidget *first = nullptr;
  for (const auto &value : values) {
    GtkWidget *b = gtk_toggle_button_new_with_label(value.c_str());
    if (first) {
      gtk_toggle_button_set_group(GTK_TOGGLE_BUTTON(b), GTK_TOGGLE_BUTTON(first));
    } else {
      first = b;
    }
    if (c) {
      g_signal_connect(b, "toggled", G_CALLBACK(+[](GtkToggleButton *button, gpointer data) {
        if (!gtk_toggle_button_get_active(button)) {
          return;
        }
        auto *c = static_cast<Control *>(data);
        guint index = 0;
        for (GtkWidget *s = gtk_widget_get_first_child(c->widget); s && s != GTK_WIDGET(button); s = gtk_widget_get_next_sibling(s)) {
          ++index;
        }
        segmentChosen(c, index);
      }), c);
    }
    gtk_box_append(GTK_BOX(segments), b);
  }
}

void selectSegment(GtkWidget *segments, int index) {
  if (haveAdwToggleGroup()) {
    adwFunction<ToggleGroupSetActive>("adw_toggle_group_set_active")(segments, index < 0 ? kNoSegment : static_cast<guint>(index));
    return;
  }
  int i = 0;
  for (GtkWidget *b = gtk_widget_get_first_child(segments); b; b = gtk_widget_get_next_sibling(b), ++i) {
    gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(b), i == index);
  }
}

// --- Date picker ------------------------------------------------------------------------------

// The picker's date as the locale writes it, in the local time zone.
std::string dateLabel(const NativeControlProps &p) {
  GDateTime *at = g_date_time_new_from_unix_local(static_cast<gint64>(std::floor(p.date.value_or(0) / 1000)));
  if (!at) {
    return {};
  }
  const char *format = p.mode == "time" || p.mode == "countdown" ? "%X" : p.mode == "datetime" ? "%x %X" : "%x";
  gchar *text = g_date_time_format(at, format);
  std::string out = text ? text : "";
  g_free(text);
  g_date_time_unref(at);
  return out;
}

bool picksDate(const NativeControlProps &p) {
  return p.mode == "date" || p.mode == "datetime";
}

// The day chosen in the calendar, at the time of day the picker held, kept within its bounds. A
// held date GLib cannot represent (after the year 9999) has no time of day: the day's start.
void dayChosen(Control *c) {
  const auto *p = controlProps(*c->view);
  if (!p || c->applying) {
    return;
  }
  GDateTime *was = g_date_time_new_from_unix_local(static_cast<gint64>(std::floor(p->date.value_or(0) / 1000)));
  GDateTime *day = gtk_calendar_get_date(GTK_CALENDAR(c->calendar));
  GDateTime *at = g_date_time_new_local(
      g_date_time_get_year(day), g_date_time_get_month(day), g_date_time_get_day_of_month(day), was ? g_date_time_get_hour(was) : 0,
      was ? g_date_time_get_minute(was) : 0, was ? g_date_time_get_seconds(was) : 0);
  double ms = static_cast<double>(g_date_time_to_unix(at)) * 1000;
  ms = std::max(ms, p->minimumDate.value_or(ms));
  ms = std::min(ms, p->maximumDate.value_or(ms));
  // The offset at the instant sent, which a bound can move across a daylight-saving change.
  GDateTime *sent = g_date_time_new_from_unix_local(static_cast<gint64>(std::floor(ms / 1000)));
  double offset = sent ? static_cast<double>(g_date_time_get_utc_offset(sent)) / G_TIME_SPAN_MINUTE : 0;
  // The calendar shows the day sent: a bound's day, not the rejected one, when the app's date
  // stays the same and so moves nothing.
  if (sent) {
    c->applying = true;
    gtk_calendar_select_day(GTK_CALENDAR(c->calendar), sent);
    c->applying = false;
  }
  if (was) {
    g_date_time_unref(was);
  }
  g_date_time_unref(day);
  g_date_time_unref(at);
  if (sent) {
    g_date_time_unref(sent);
  }
  send(c, "change", folly::dynamic::object("timestamp", ms)("utcOffset", offset));
  if (GtkPopover *popover = gtk_menu_button_get_popover(GTK_MENU_BUTTON(c->widget))) {
    gtk_popover_popdown(popover);
  }
}

// --- Search field -----------------------------------------------------------------------------

void searchEvent(GtkWidget *entry, const char *name, bool withText) {
  auto *c = controlOf(entry);
  if (!c || c->applying) {
    return;
  }
  const char *text = gtk_editable_get_text(GTK_EDITABLE(entry));
  folly::dynamic payload = folly::dynamic::object();
  if (withText) {
    payload["text"] = text ? text : "";
  }
  if (std::string_view(name) == "changeText") {
    payload["eventCount"] = ++c->eventCount;
  }
  send(c, name, std::move(payload));
}

// Empties the field and sends the cancel, as AppKit's clear button does.
void cancelSearch(GtkWidget *entry) {
  gtk_editable_set_text(GTK_EDITABLE(entry), "");
  searchEvent(entry, "pressCancel", false);
}

// The click GtkSearchEntry clears the field on, from its clear icon: GTK sends no stop-search for it.
GtkGesture *clearIconClick(GtkWidget *entry) {
  for (GtkWidget *child = gtk_widget_get_first_child(entry); child; child = gtk_widget_get_next_sibling(child)) {
    if (!GTK_IS_IMAGE(child) || g_strcmp0(gtk_image_get_icon_name(GTK_IMAGE(child)), "edit-clear-symbolic") != 0) {
      continue;
    }
    GListModel *controllers = gtk_widget_observe_controllers(child);
    GtkGesture *click = nullptr;
    for (guint i = 0; !click && i < g_list_model_get_n_items(controllers); ++i) {
      gpointer controller = g_list_model_get_item(controllers, i);
      if (GTK_IS_GESTURE_CLICK(controller)) {
        click = GTK_GESTURE(controller);
      }
      g_object_unref(controller);
    }
    g_object_unref(controllers);
    return click;
  }
  return nullptr;
}

void wireSearch(GtkWidget *entry) {
  // Each change as it is made, as AppKit's field sends it: GTK's search-changed waits for a pause.
  g_signal_connect(entry, "changed", G_CALLBACK(+[](GtkEditable *e, gpointer) { searchEvent(GTK_WIDGET(e), "changeText", true); }), nullptr);
  g_signal_connect(entry, "activate", G_CALLBACK(+[](GtkSearchEntry *e, gpointer) { searchEvent(GTK_WIDGET(e), "submitSearch", true); }), nullptr);
  // Escape and the clear icon empty the field, as the cancel button of AppKit's does.
  g_signal_connect(entry, "stop-search", G_CALLBACK(+[](GtkSearchEntry *e, gpointer) { cancelSearch(GTK_WIDGET(e)); }), nullptr);
  if (GtkGesture *click = clearIconClick(entry)) {
    g_signal_connect_after(click, "released", G_CALLBACK(+[](GtkGestureClick *, int, double, double, gpointer e) {
      cancelSearch(GTK_WIDGET(e));
    }), entry);
  }
  GtkEventController *focus = gtk_event_controller_focus_new();
  g_signal_connect(focus, "enter", G_CALLBACK(+[](GtkEventControllerFocus *f, gpointer) {
    searchEvent(gtk_event_controller_get_widget(GTK_EVENT_CONTROLLER(f)), "beginEditing", false);
  }), nullptr);
  g_signal_connect(focus, "leave", G_CALLBACK(+[](GtkEventControllerFocus *f, gpointer) {
    searchEvent(gtk_event_controller_get_widget(GTK_EVENT_CONTROLLER(f)), "endEditing", false);
  }), nullptr);
  gtk_widget_add_controller(entry, focus);
}

// --- Making and applying ----------------------------------------------------------------------

GtkWidget *makeWidget(ControlKind kind, const NativeControlProps &p) {
  switch (kind) {
    case ControlKind::Button:
      return gtk_button_new();
    case ControlKind::Switch: {
      GtkWidget *toggle = gtk_switch_new();
      gtk_widget_set_halign(toggle, GTK_ALIGN_CENTER);
      gtk_widget_set_valign(toggle, GTK_ALIGN_CENTER);
      return toggle;
    }
    case ControlKind::ActivityIndicator:
      return makeSpinner(wantsAdwSpinner(p));
    case ControlKind::SegmentedControl:
      return makeSegments();
    case ControlKind::DatePicker:
      return gtk_menu_button_new();
    case ControlKind::SearchField:
      return gtk_search_entry_new();
  }
  return gtk_button_new();
}

// What of `p` the control's size depends on, on a control with no view (the measurer's) or a view's.
void configure(Control *c, ControlKind kind, GtkWidget *widget, const NativeControlProps &p) {
  switch (kind) {
    case ControlKind::Button:
      configureButton(widget, p);
      break;
    case ControlKind::ActivityIndicator:
      gtk_widget_set_size_request(widget, spinnerSize(p), spinnerSize(p));
      break;
    case ControlKind::SegmentedControl:
      if (!c || c->values != p.values) {
        fillSegments(c, widget, p.values);
        if (c) {
          c->values = p.values;
        }
      }
      break;
    case ControlKind::DatePicker:
      gtk_menu_button_set_label(GTK_MENU_BUTTON(widget), dateLabel(p).c_str());
      break;
    case ControlKind::SearchField:
      gtk_search_entry_set_placeholder_text(GTK_SEARCH_ENTRY(widget), p.placeholder.c_str());
      break;
    case ControlKind::Switch:
      break;
  }
}

void wire(Control *c) {
  GtkWidget *w = c->widget;
  g_object_set_data(G_OBJECT(w), "ngn-control", c);
  switch (c->kind) {
    case ControlKind::Button:
      g_signal_connect(w, "clicked", G_CALLBACK(+[](GtkButton *b, gpointer) { send(controlOf(GTK_WIDGET(b)), "buttonPress", folly::dynamic::object()); }), nullptr);
      break;
    case ControlKind::Switch:
      g_signal_connect(w, "notify::active", G_CALLBACK(+[](GObject *o, GParamSpec *, gpointer) {
        auto *c = controlOf(GTK_WIDGET(o));
        if (c && !c->applying) {
          send(c, "change", folly::dynamic::object("value", static_cast<bool>(gtk_switch_get_active(GTK_SWITCH(o))))("target", c->view->tag));
        }
      }), nullptr);
      break;
    case ControlKind::SegmentedControl:
      if (haveAdwToggleGroup()) {
        g_signal_connect(w, "notify::active", G_CALLBACK(+[](GObject *o, GParamSpec *, gpointer) {
          if (auto *c = controlOf(GTK_WIDGET(o))) {
            segmentChosen(c, adwFunction<ToggleGroupGetActive>("adw_toggle_group_get_active")(GTK_WIDGET(o)));
          }
        }), nullptr);
      }
      break;
    case ControlKind::DatePicker: {
      c->calendar = gtk_calendar_new();
      GtkWidget *popover = gtk_popover_new();
      gtk_popover_set_child(GTK_POPOVER(popover), c->calendar);
      gtk_menu_button_set_popover(GTK_MENU_BUTTON(w), popover);
      g_signal_connect(c->calendar, "day-selected", G_CALLBACK(+[](GtkCalendar *, gpointer data) { dayChosen(static_cast<Control *>(data)); }), c);
      break;
    }
    case ControlKind::SearchField:
      wireSearch(w);
      break;
    case ControlKind::ActivityIndicator:
      break;
  }
}

void attach(GtkWidget *view, Control *c) {
  gtk_widget_set_parent(c->widget, view);
  // Freed with its widget, after its last signal.
  g_object_set_data_full(G_OBJECT(c->widget), "ngn-control-owner", c, [](gpointer p) { delete static_cast<Control *>(p); });
}

} // namespace

void setControlEventSink(ControlEventSink sink) {
  eventSink() = std::move(sink);
}

bool haveAdwSpinner() {
  static bool have = adwFunction<GtkWidget *(*)()>("adw_spinner_new") != nullptr;
  return have;
}

bool haveAdwToggleGroup() {
  static bool have = adwFunction<ToggleGroupNew>("adw_toggle_group_new") && adwFunction<ToggleNew>("adw_toggle_new") &&
      adwFunction<ToggleSetLabel>("adw_toggle_set_label") && adwFunction<ToggleGroupAdd>("adw_toggle_group_add") &&
      adwFunction<ToggleGroupRemoveAll>("adw_toggle_group_remove_all") &&
      adwFunction<ToggleGroupSetActive>("adw_toggle_group_set_active") &&
      adwFunction<ToggleGroupGetActive>("adw_toggle_group_get_active");
  return have;
}

void makeControl(GtkWidget *widget, ViewData &view) {
  auto kind = controlKind(view.component);
  const auto *p = controlProps(view);
  if (!kind || !p) {
    return;
  }
  auto *c = new Control{.kind = *kind, .view = &view};
  c->widget = makeWidget(*kind, *p);
  c->adwSpinner = *kind == ControlKind::ActivityIndicator && wantsAdwSpinner(*p);
  wire(c);
  attach(widget, c);
  view.control = c->widget;
  applyControlProps(view);
}

void applyControlProps(ViewData &view) {
  Control *c = view.control ? controlOf(view.control) : nullptr;
  const auto *p = controlProps(view);
  if (!c || !p) {
    return;
  }
  // The control is the view's ViewData's to point at, whichever widget holds it now.
  c->view = &view;
  if (c->kind == ControlKind::ActivityIndicator && c->adwSpinner != wantsAdwSpinner(*p)) {
    // A spinner that is to stay shown while stopped, or no longer: the other kind of spinner.
    GtkWidget *parent = gtk_widget_get_parent(c->widget);
    auto *next = new Control{.kind = c->kind, .view = &view, .adwSpinner = wantsAdwSpinner(*p)};
    next->widget = makeSpinner(next->adwSpinner);
    wire(next);
    gtk_widget_unparent(c->widget);
    attach(parent, next);
    view.control = next->widget;
    c = next;
  }
  c->applying = true;
  GtkWidget *w = c->widget;
  configure(c, c->kind, w, *p);
  gtk_widget_set_sensitive(w, p->enabled);
  // The app's label for the control, which reads its own (a button's title) without one.
  // And its hint, which the view around the control is no accessible element to carry.
  for (auto [property, text] : {std::pair{GTK_ACCESSIBLE_PROPERTY_LABEL, &p->accessibilityLabel},
                                std::pair{GTK_ACCESSIBLE_PROPERTY_DESCRIPTION, &p->accessibilityHint}}) {
    if (!text->empty()) {
      gtk_accessible_update_property(GTK_ACCESSIBLE(w), property, text->c_str(), -1);
    } else {
      gtk_accessible_reset_property(GTK_ACCESSIBLE(w), property);
    }
  }
  switch (c->kind) {
    case ControlKind::Switch:
      // Only a change: setting the same value ends the slide a click started, and the click with it.
      if (static_cast<bool>(gtk_switch_get_active(GTK_SWITCH(w))) != p->value) {
        gtk_switch_set_active(GTK_SWITCH(w), p->value);
      }
      break;
    case ControlKind::ActivityIndicator: {
      gtk_widget_set_visible(w, p->animating || !p->hidesWhenStopped);
      if (!c->adwSpinner) {
        gtk_spinner_set_spinning(GTK_SPINNER(w), p->animating);
      }
      std::string color = colorClass("color", p->color);
      if (color != c->colorClass) {
        if (!c->colorClass.empty()) {
          gtk_widget_remove_css_class(w, c->colorClass.c_str());
        }
        if (!color.empty()) {
          gtk_widget_add_css_class(w, color.c_str());
        }
        c->colorClass = color;
      }
      break;
    }
    case ControlKind::SegmentedControl:
      selectSegment(w, p->selectedIndex);
      break;
    case ControlKind::DatePicker: {
      // Only a new date from the app moves the calendar, not another prop's update.
      if (p->date != c->date && p->date) {
        GDateTime *at = g_date_time_new_from_unix_local(static_cast<gint64>(std::floor(*p->date / 1000)));
        if (at) {
          gtk_calendar_select_day(GTK_CALENDAR(c->calendar), at);
          g_date_time_unref(at);
        }
      }
      c->date = p->date;
      // The time modes have nothing to pick from yet: the button shows the time alone.
      gtk_widget_set_sensitive(w, p->enabled && picksDate(*p));
      break;
    }
    case ControlKind::SearchField: {
      // JavaScript's text, unless the user has typed since it was sent.
      const char *now = gtk_editable_get_text(GTK_EDITABLE(w));
      if (p->mostRecentEventCount >= c->eventCount && p->text != (now ? now : "")) {
        gtk_editable_set_text(GTK_EDITABLE(w), p->text.c_str());
      }
      break;
    }
    case ControlKind::Button:
      break;
  }
  c->applying = false;
}

void controlCommand(ViewData &view, const std::string &name, const folly::dynamic &args) {
  Control *c = view.control ? controlOf(view.control) : nullptr;
  if (!c) {
    return;
  }
  if (c->kind == ControlKind::Switch && (name == "setValue" || name == "setNativeValue") && args.isArray() && !args.empty() && args[0].isBool()) {
    c->applying = true;
    gtk_switch_set_active(GTK_SWITCH(c->widget), args[0].asBool());
    c->applying = false;
  } else if (c->kind == ControlKind::SearchField && name == "focus") {
    gtk_widget_grab_focus(c->widget);
  } else if (c->kind == ControlKind::SearchField && name == "blur") {
    // Only this field's focus, which the text inside it holds: not another field's.
    GtkRoot *root = gtk_widget_get_root(c->widget);
    GtkWidget *focus = root ? gtk_root_get_focus(root) : nullptr;
    if (focus && (focus == c->widget || gtk_widget_is_ancestor(focus, c->widget))) {
      gtk_root_set_focus(root, nullptr);
    }
  }
}

facebook::react::Size GtkControlMeasurer::measure(ControlKind kind, const NativeControlProps &p) const {
  if (kind == ControlKind::ActivityIndicator) {
    auto size = static_cast<facebook::react::Float>(spinnerSize(p));
    return {size, size};
  }
  GtkWidget *widget = GTK_WIDGET(g_object_ref_sink(makeWidget(kind, p)));
  configure(nullptr, kind, widget, p);
  int minimum = 0, width = 0, height = 0;
  gtk_widget_measure(widget, GTK_ORIENTATION_HORIZONTAL, -1, &minimum, &width, nullptr, nullptr);
  gtk_widget_measure(widget, GTK_ORIENTATION_VERTICAL, width, &minimum, &height, nullptr, nullptr);
  g_object_unref(widget);
  return {static_cast<facebook::react::Float>(width), static_cast<facebook::react::Float>(height)};
}

} // namespace ngn::gtk
