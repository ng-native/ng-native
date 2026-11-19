// cairo under the core's SvgCanvas: an svg view draws its document (ngn/svg.h) with it, into a
// cairo node of its snapshot, as the macOS host draws it with Core Graphics (appkit/cg-canvas.h).
// GSK strokes and fills paths itself only from GTK 4.14, above the 4.10 floor, and cairo has the
// masks, groups and repeating surfaces the rest needs. Text is Pango's.
#pragma once

#include "ngn/svg.h"

#include <cairo.h>

#include <functional>
#include <memory>
#include <set>
#include <string>

namespace ngn::gtk {

// The images an svg view drew last, which the shared cache keeps while it holds them: an svg that
// draws more images than the cache keeps does not load them in turn for ever.
class SvgImageHold {
 public:
  SvgImageHold() = default;
  SvgImageHold(const SvgImageHold &) = delete;
  SvgImageHold &operator=(const SvgImageHold &) = delete;
  ~SvgImageHold();
  // A uri a draw asked for. The uris one draw asked for replace those held when it ends (`drawn`).
  void use(const std::string &uri);
  void drawn();

 private:
  std::set<std::string> held_, next_;
};

// A canvas over `cr`, whose user space is the view's: top left, y down, in points, `width` by
// `height`, drawn at `scale` pixels a point. `imageLoaded` runs on the UI thread when an image it
// was asked for has loaded or failed to. The images it draws are noted in `hold`, when given. A
// foreignObject's views are not drawn.
std::unique_ptr<SvgCanvas> makeCairoCanvas(
    cairo_t *cr,
    double width,
    double height,
    double scale,
    std::function<void()> imageLoaded = nullptr,
    SvgImageHold *hold = nullptr);

} // namespace ngn::gtk
