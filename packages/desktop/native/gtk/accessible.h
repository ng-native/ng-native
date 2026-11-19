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

#include <react/renderer/mounting/ShadowView.h>

#include <gtk/gtk.h>

namespace ngn::gtk {

// The view's accessibility as the core reads it: a Paragraph's from its text, any other's from its
// props. Nothing for a view without View props.
std::optional<AxInfo> accessibilityOf(const facebook::react::ShadowView &view);

// GTK's role for the view: its ARIA role, `generic` for one that is no element of its own (read
// through) or has no View props.
GtkAccessibleRole accessibleRole(const facebook::react::ShadowView &view);

// GTK's name for an ARIA role.
GtkAccessibleRole gtkRole(AriaRole role);

// Sets what the widget says beyond its role, and resets what `info` no longer has.
void applyAccessibility(GtkWidget *widget, const AxInfo &info);

} // namespace ngn::gtk
