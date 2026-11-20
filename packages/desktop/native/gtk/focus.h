// The focus on GTK, which the core owns (focus-order.h). A window's capture-phase key controller
// (menus.h's KeyRouting) gives Tab and Shift-Tab to the core's Tab order, and the arrow keys, Home
// and End to the composite widget the focus is in, before GTK's own focus moves see them; each move
// grabs real GTK focus on the view's widget, so an assistive technology hears it. Tab stays in the
// container the focus is in (focusContainer), and in the presentation in front of the window.
//
// A plain view's widget is focusable as its desktop props say (viewTakesFocus), takes the focus on
// a click, and reports its GTK focus back as the view's `focus` and `blur`, however it came: a key,
// a click, or an assistive technology moving it. A key's focus is focus-visible.
#pragma once

#include "ngn/view-tree.h"

#include <gtk/gtk.h>

namespace ngn::gtk {

class GtkBackend;
struct ViewData;

// Tab, Shift-Tab and the composite keys pressed in `window`. True when the key was used.
bool moveFocusByKey(GtkWindow *window, guint keyval, GdkModifierType state, GtkBackend &backend, const ViewTree &tree);

// The widget that takes the focus for a view: its text field, its native control, or the view.
GtkWidget *focusWidget(const ViewData &view);

// Whether the view's own widget takes the focus, from its desktop props; set as they change.
void applyFocusable(GtkWidget *widget, const ViewData &view);

// Focuses the view's widget on a click, when it takes the focus; set once, as its widget is made.
void watchFocus(GtkWidget *widget);

// Reports the focus moving between views in `window` as their `focus` and `blur`, and marks the
// focused one for its ring; once per window.
void trackFocus(GtkWindow *window);

} // namespace ngn::gtk
