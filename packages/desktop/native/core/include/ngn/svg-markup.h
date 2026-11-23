// An icon's SVG markup, such as an `@ng-icons` set's, read into the document drawSvg draws, for the
// places a desktop toolkit takes an image rather than a view: a sidebar row, a button and a tab.
// `<sidebar-item>` and `<native-button>` commit the markup as `svgIcon`; `<native-tab>` commits it
// as a `data:image/svg+xml` icon source.
//
// The markup is read as far as an icon needs: `svg` with its viewBox and preserveAspectRatio, `g`,
// `path`, `rect`, `circle`, `ellipse`, `line`, `polyline` and `polygon`, with their presentation
// attributes, written as attributes or in `style` (which wins), and `transform`. A `var()` takes its
// fallback, which is how an outline set carries its stroke width. Anything else (gradients, clips,
// masks, text, `use`) is left out, since the icon is drawn in one colour.
#pragma once

#include "ngn/svg.h"

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace ngn {

// The document `markup` draws, or nothing when it is not an `svg` element.
std::optional<SvgDocument> parseSvgMarkup(std::string_view markup);

// `document` with every paint in `argb`, each keeping its own opacity: the colour a toolkit tints a
// template image or a symbolic icon with. A shape that sets no fill fills in it too.
SvgDocument svgPaintedIn(const SvgDocument &document, uint32_t argb);

// The markup of a `data:image/svg+xml` uri, percent-encoded or base64, or nothing for another uri.
std::optional<std::string> svgMarkupOfUri(std::string_view uri);

} // namespace ngn
