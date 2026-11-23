// An icon's SVG markup (ngn/svg-markup.h) as GTK draws it in a sidebar row, a button or a tab: in
// the widget's own CSS colour, as GTK draws a symbolic icon, so it follows the row's selection,
// the dark style and high contrast as the text beside it does.
#pragma once

#include <gtk/gtk.h>

#include <string>

namespace ngn::gtk {

// A widget `size` points square drawing `markup`, or null when it is no svg. It is no accessible
// element: the label beside it names what it is on.
GtkWidget *makeSvgIcon(const std::string &markup, int size);

} // namespace ngn::gtk
