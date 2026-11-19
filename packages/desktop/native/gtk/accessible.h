// A view's accessibility through GTK's own: the core's ARIA role for it (aria-role.h) as the
// widget's accessible role, set as GTK makes the widget, and the core's AxInfo (accessibility.h)
// as its label, description, level and states, updated as the props change. GTK then exposes the
// widget over AT-SPI.
//
// GTK fixes a widget's role when it makes it, so the backend replaces the widget of a view whose
// role changes (GtkBackend). Orca's structural navigation (headings and landmarks) needs AT-SPI
// Collection, which GTK does not implement, so it finds nothing in a GTK app: a documented gap.
#pragma once

#include "ngn/accessibility.h"
#include "ngn/aria-role.h"
#include "ngn/system.h"

#include <react/renderer/mounting/ShadowView.h>

#include <gtk/gtk.h>

#include <functional>
#include <string>
#include <utility>
#include <vector>

namespace ngn::gtk {

struct ViewData;

// The view's accessibility as the core reads it: a Paragraph's from its text, any other's from its
// props. Nothing for a view without View props.
std::optional<AxInfo> accessibilityOf(const facebook::react::ShadowView &view);

// GTK's role for the view: its ARIA role, `generic` for one that is no element of its own (read
// through), has no View props, or holds the element (a native control, a text input's field).
GtkAccessibleRole accessibleRole(const facebook::react::ShadowView &view);

// GTK's name for an ARIA role.
GtkAccessibleRole gtkRole(AriaRole role);

// Sets what the widget says beyond its role, and resets what `info` no longer has.
void applyAccessibility(GtkWidget *widget, const AxInfo &info);

// The widget that is the view's accessible element: a text input's field, else the view's own.
GtkWidget *accessibleWidget(const ViewData &view);

// Where a view's accessible actions go: `perform` sends a press, increment, decrement or cancel,
// and `send` a declared action by the name the app gave it.
struct AccessibleActionSinks {
  std::function<bool(GtkWidget *, AxVerb)> perform;
  std::function<bool(GtkWidget *, const std::string &)> send;
};

// The view's press, increment, decrement and cancel as the widget's `accessibility` actions, which
// GTK lists on AT-SPI's Action interface for a screen reader to invoke, each enabled while `info`
// offers it, as AppKit's perform methods are; and its declared actions (`accessibilityActions`) as
// its `custom` actions, as AppKit lists custom actions. GTK gives AT-SPI an action's name and no
// label, so a screen reader reads `custom.<name>`. A native control and a text input's field are
// GTK's own widgets with GTK's own actions, and get none.
void applyAccessibleActions(GtkWidget *widget, const AxInfo &info, AccessibleActionSinks sinks);

// The declared actions' GAction names, with the names the app declared: a GAction name takes only
// letters, digits, '-' and '.', so each other character becomes '-', and a name already taken gets
// a number ("delete-2").
std::vector<std::pair<std::string, std::string>> customActionNames(const std::vector<AxAction> &declared);

// Says `announcement` through `widget`'s window, at its priority, with gtk_accessible_announce,
// found at run time: GTK 4.14 and later. Below it nothing is said. Whether it was.
bool announceOn(GtkWidget *widget, const Announcement &announcement);

} // namespace ngn::gtk
