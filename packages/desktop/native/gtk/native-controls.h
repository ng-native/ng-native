// The native controls of native-controls.h as GTK and libadwaita draw them, each a widget filling
// its view, with the events and commands the AppKit host sends and takes:
//
//   <native-button>        GtkButton: `default` is a suggested action, `destructive` a destructive
//                          one, `plain` flat, and one with no kind a plain push button
//   <switch>               GtkSwitch
//   <activity-indicator>   AdwSpinner on libadwaita 1.6 and later, found at run time, else GtkSpinner
//   <segmented-control>    AdwToggleGroup on libadwaita 1.7 and later, found at run time, else a
//                          linked row of GtkToggleButtons
//   <date-time-picker>     a GtkMenuButton showing the date, with a GtkCalendar in its popover; the
//                          time modes show the time, and pick nothing yet
//   <search-field>         GtkSearchEntry
//
// `controlSize` and `sfSymbol` are AppKit's and do nothing here, as on Android.
#pragma once

#include "view-widget.h"

#include "ngn/native-controls.h"

#include <folly/dynamic.h>

#include <gtk/gtk.h>

#include <functional>
#include <string>

namespace ngn::gtk {

// Where the controls' events go in place of each view's emitter, for tests, which have no event
// dispatcher to read them from; null for the emitters.
using ControlEventSink = std::function<void(facebook::react::Tag tag, const std::string &name, const folly::dynamic &payload)>;
void setControlEventSink(ControlEventSink sink);

// Makes the control of `view`, child of `widget`, when its component is one; else does nothing.
void makeControl(GtkWidget *widget, ViewData &view);
// Applies `view.props` to its control, if it has one.
void applyControlProps(ViewData &view);
// The switch's setValue and setNativeValue, and the search field's focus and blur.
void controlCommand(ViewData &view, const std::string &name, const folly::dynamic &args);

// Whether libadwaita has AdwSpinner (1.6) and AdwToggleGroup (1.7) at run time.
bool haveAdwSpinner();
bool haveAdwToggleGroup();

// Sizes the controls as GTK lays them out, on the UI thread only (ControlSizes calls it there).
class GtkControlMeasurer final : public ControlMeasurer {
 public:
  facebook::react::Size measure(ControlKind kind, const NativeControlProps &props) const override;
};

} // namespace ngn::gtk
