// A view's box (describeBox, view-box.h) as GSK render nodes, in the order CSS paints it: the outer
// shadows, the last listed lowest; the background colour and then the background images in the
// border box's shape, each image's first tile under a repeat node; the inset shadows in the padding
// box; the border.
//
// A dashed or dotted border is a cairo node stroked by the core's drawBorder, as on macOS: GSK
// strokes paths only from GTK 4.14, and the host builds against el9's 4.12.
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
