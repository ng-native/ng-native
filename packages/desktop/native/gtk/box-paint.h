// A view's box (describeBox, view-box.h) as GSK render nodes, in the order CSS paints it: the outer
// shadows, the last listed lowest; the background in the border box's shape; the inset shadows in
// the padding box; the border.
//
// A dashed or dotted border is drawn solid: GSK strokes paths only from GTK 4.14, and the cairo
// fallback below it comes with the rest of the toolkit look.
#pragma once

#include "ngn/view-box.h"

#include <gtk/gtk.h>

#include <functional>

namespace ngn::gtk {

GdkRGBA rgbaOf(uint32_t argb);

// The rect with its corners rounded, the radii scaled down together where neighbours overlap, as
// CSS does.
GskRoundedRect gskRoundedRect(const SvgRect &rect, const CornerRadii &radii);

// `content`, when given, draws between the inset shadows and the border, as a layer's contents
// draw under its border.
void appendBox(GtkSnapshot *snapshot, const BoxDescription &box, const std::function<void()> &content = nullptr);

// Cuts what follows to the box's shape when it clips its overflow: true when it pushed a clip,
// which the caller pops.
bool pushOverflowClip(GtkSnapshot *snapshot, const BoxDescription &box);

} // namespace ngn::gtk
