// An icon's SVG markup (ngn/svg-markup.h) as GTK draws it in a sidebar row, a button or a tab: in
// the widget's own CSS colour, as GTK draws a symbolic icon, so it follows the row's selection,
// the dark style and high contrast as the text beside it does.
#pragma once

#include <gtk/gtk.h>

#include <cstdint>
#include <initializer_list>
#include <string>

namespace ngn::gtk {

// A widget `size` points square drawing `markup`, or null when it is no svg. It is no accessible
// element: the label beside it names what it is on.
GtkWidget *makeSvgIcon(const std::string &markup, int size);

// `markup` drawn `size` pixels square in `argb` as a PNG, for an image another process draws (a
// tray menu's item), or empty when it is no svg.
std::string svgIconPng(const std::string &markup, int size, uint32_t argb);

// `markup` drawn in `argb` as a StatusNotifierItem's IconPixmap, `a(iiay)`: an image at each of
// `sizes` pixels square, each non-premultiplied ARGB32 in network byte order, as the spec has it.
// An empty array when it is no svg.
GVariant *svgIconPixmaps(const std::string &markup, uint32_t argb, std::initializer_list<int> sizes = {16, 22, 32, 48});

} // namespace ngn::gtk
