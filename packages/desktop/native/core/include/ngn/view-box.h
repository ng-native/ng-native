// A view's box as React Native iOS paints it (RCTViewComponentView, RCTBorderDrawing,
// RCTBoxShadow, RCTLinearGradient, RCTRadialGradient and RCTBackgroundImageUtils), with CSS's
// meaning where it reads a value: its background colour and images, its borders, its corner radii
// and its box shadows.
//
// Core Animation draws a box whose corners share one radius and whose border is one solid width
// and colour, on the view's own layer, as React Native iOS does; it draws the border over the
// view's children, so only where that cannot show (no border, a clear one, or a view that clips).
// Every other box is drawn by drawViewBox on an SvgCanvas over the view's own contents, under its
// children: the background in the border box's shape, the background images, then each side of the
// border in its own width and colour. A box shadow is a layer of its own (BoxShadowLayer), as
// Core Animation blurs it.
#pragma once

#include "ngn/svg.h"

#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/LayoutMetrics.h>
#include <react/renderer/graphics/BoxShadow.h>
#include <react/renderer/graphics/LinearGradient.h>
#include <react/renderer/graphics/RadialGradient.h>

#include <cstdint>
#include <optional>
#include <vector>

namespace ngn {

// Each corner's radius across (x) and down (y).
struct CornerRadii {
  struct Corner {
    double x{0}, y{0};
    bool operator==(const Corner &) const = default;
  };
  Corner topLeft, topRight, bottomRight, bottomLeft;

  // One radius, the same across and down at every corner: what a layer's cornerRadius draws.
  bool circular() const;
  bool operator==(const CornerRadii &) const = default;
};

struct EdgeWidths {
  double top{0}, right{0}, bottom{0}, left{0};
  bool operator==(const EdgeWidths &) const = default;
};

// The radii of the box inside a border: each less the width of the side it meets, never below 0.
CornerRadii innerRadii(const CornerRadii &radii, const EdgeWidths &widths);

// The radii of a shadow's shape, spread by `spread` (CSS's rule, which grows a small radius less).
CornerRadii spreadRadii(const CornerRadii &radii, double spread);

// The rect with its corners rounded, clockwise from the top left, each radius kept within what the
// opposite corner on its side leaves. `reversed` runs it anticlockwise, so that it cuts a hole in
// a path filled by the nonzero rule.
SvgPath roundedRect(const SvgRect &rect, const CornerRadii &radii, bool reversed = false);

// A gradient's stops, from 0 at its start to 1 at its end, as CSS places them: a missing first or
// last position at the end, the missing ones between spread evenly, none before the one before,
// a length taken along `lineLength`, and a colour hint as the curve of stops it stands for.
std::vector<std::pair<double, uint32_t>> gradientStops(
    const std::vector<facebook::react::ColorStop> &stops,
    double lineLength);

// A gradient filling a tile of `size` whose top left is at (0, 0), ready for SvgCanvas. Stops
// before the start or past the end move its ends out, so that none is cut off.
SvgGradient linearGradient(const facebook::react::LinearGradient &gradient, double width, double height);
// nullopt when the gradient has no area (a radius of 0).
std::optional<SvgGradient> radialGradient(const facebook::react::RadialGradient &gradient, double width, double height);

// Where one background image's tiles go, in the view's coordinates: the size background-size
// gives it in the positioning area (the padding box), placed by background-position and repeated
// by background-repeat over the painting area (the border box, from (0, 0)). A gradient has no
// size of its own, so `auto`, `cover` and `contain` are the positioning area's.
std::vector<SvgRect> backgroundTiles(
    const SvgRect &positioningArea,
    const SvgRect &paintingArea,
    const facebook::react::BackgroundSize &size,
    const facebook::react::BackgroundPosition &position,
    const facebook::react::BackgroundRepeat &repeat);

// A box shadow as a layer the size of the view, which Core Animation blurs.
struct BoxShadowLayer {
  bool inset{false};
  uint32_t argb{0xff000000};
  // The layer's shadowRadius: half the CSS blur, React Native iOS's match for the web's.
  double radius{0};
  // The shape that casts the shadow, filled by the nonzero rule.
  SvgPath shadowPath;
  // Where the layer shows: outside the view's box for an outer shadow (by the even-odd rule), and
  // inside its padding box for an inset one.
  SvgPath mask;
  bool maskEvenOdd{false};
  bool operator==(const BoxShadowLayer &) const = default;
};

// What the backend sets on a view's own layer and adds to it.
struct ViewBox {
  // Core Animation draws the background and border: the layer's backgroundColor, cornerRadius,
  // borderWidth and borderColor are these. Otherwise the layer has no background or border, and
  // drawViewBox draws them.
  bool layerDrawn{true};
  std::optional<uint32_t> background;
  double borderWidth{0};
  std::optional<uint32_t> borderColor;
  // The layer's cornerRadius, which also clips a view that clips its overflow, when every corner
  // has the same radius; 0 when they differ.
  double cornerRadius{0};
  // Whether drawViewBox draws anything: the background and border when the layer does not, and
  // background images.
  bool drawn{false};
  // For a view that clips its overflow when its corners differ: the border box's shape, the
  // layer's mask.
  std::optional<SvgPath> clip;
  // Bottom first: the last shadow CSS lists is under the others.
  std::vector<BoxShadowLayer> shadows;
  bool operator==(const ViewBox &) const = default;
};

ViewBox viewBox(const facebook::react::ViewProps &props, const facebook::react::LayoutMetrics &layout);

// Draws what the layer does not: the background colour in the border box's shape, the background
// images, and the border side by side. Draws nothing for a box viewBox says is not `drawn`.
void drawViewBox(const facebook::react::ViewProps &props, const facebook::react::LayoutMetrics &layout, SvgCanvas &canvas);

} // namespace ngn
