// cairo under the core's SvgCanvas: an svg view draws its document (ngn/svg.h) with it, into a
// cairo node of its snapshot, as the macOS host draws it with Core Graphics (appkit/cg-canvas.h).
// GSK strokes and fills paths itself only from GTK 4.14, above the 4.10 floor, and cairo has the
// masks, groups and repeating surfaces the rest needs. Text is Pango's.
#pragma once

#include "ngn/svg.h"

#include <cairo.h>

#include <functional>
#include <memory>

namespace ngn::gtk {

// A canvas over `cr`, whose user space is the view's: top left, y down, in points, `width` by
// `height`, drawn at `scale` pixels a point. `imageLoaded` runs on the UI thread when an image it
// was asked for has loaded. A foreignObject's views are not drawn.
std::unique_ptr<SvgCanvas> makeCairoCanvas(
    cairo_t *cr,
    double width,
    double height,
    double scale,
    std::function<void()> imageLoaded = nullptr);

} // namespace ngn::gtk
