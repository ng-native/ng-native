// A view's accessibility through GTK's own: the core's AxInfo (accessibility.h) as the widget's
// accessible role, set as GTK makes the widget, and its label, description, level and states,
// updated as the props change. GTK then exposes the widget over AT-SPI.
//
// GTK fixes a widget's role when it makes it, so a view whose role changes later keeps its first
// one until it is mounted again: replacing the widget comes with the keyboard and accessibility
// step. Orca's structural navigation (headings and landmarks) needs AT-SPI Collection, which GTK
// does not implement, so it finds nothing in a GTK app: a documented gap.
#pragma once

#include "ngn/accessibility.h"

#include <react/renderer/mounting/ShadowView.h>

#include <gtk/gtk.h>

namespace ngn::gtk {

// The view's accessibility as the core reads it: a Paragraph's from its text, any other's from its
// props. Nothing for a view without View props.
std::optional<AxInfo> accessibilityOf(const facebook::react::ShadowView &view);

// GTK's role for it. A view that is not an element of its own is `generic`, read through.
GtkAccessibleRole accessibleRole(const AxInfo &info);

// Sets what the widget says beyond its role, and resets what `info` no longer has.
void applyAccessibility(GtkWidget *widget, const AxInfo &info);

} // namespace ngn::gtk
