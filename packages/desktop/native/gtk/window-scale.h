// The scale a GTK window draws at, in device pixels a point, fractional steps included: what
// Dimensions' `scale`, PixelRatio and the layout's pixel rounding take, as macOS takes a window's
// backingScaleFactor.
//
// From GTK 4.12 GDK reports a compositor's fractional scale (1.25 or 1.333 on Wayland) as the
// surface's `scale`, found at run time; gtk_widget_get_scale_factor rounds it up to a whole number
// and changes only when that does. Below 4.12 the whole number is all there is.
#pragma once

#include <gtk/gtk.h>

#include <functional>

namespace ngn::gtk {

// `widget`'s window's scale once it shows; before, its monitor's (the first monitor's when it is on
// none yet), and 1 with no monitor at all.
double windowScale(GtkWidget *widget);

// Calls `changed` on each change of the realized `window`'s scale, a fractional one included, for
// as long as its surface lives.
void followWindowScale(GtkWidget *window, std::function<void()> changed);

} // namespace ngn::gtk
