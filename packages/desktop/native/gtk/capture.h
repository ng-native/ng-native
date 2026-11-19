// A widget drawn into a texture in-process, through GSK's cairo renderer: what the host's
// NGN_CAPTURE screenshot and the GTK view tests read. A compositor screenshot is no use where
// there is none to ask (mutter alone, Xvfb) and cannot see an offscreen window.
#pragma once

#include <gtk/gtk.h>

#include <string>

namespace ngn::gtk {

// The widget as it draws now, at its window's scale. Null before it has a size. The caller unrefs
// it.
GdkTexture *renderWidget(GtkWidget *widget);

// renderWidget, saved as a PNG at `path`.
bool captureWidget(GtkWidget *widget, const std::string &path);

} // namespace ngn::gtk
