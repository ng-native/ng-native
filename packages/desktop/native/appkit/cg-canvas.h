// Core Graphics under the core's SvgCanvas: the svg view draws its document with it, and every
// view draws its box (ngn/view-box.h) with it.
#pragma once

#import <AppKit/AppKit.h>

#include "ngn/svg.h"

#include <memory>
#include <string>

// Both answer a +1 reference the caller releases.
CGColorRef NGNCreateColor(uint32_t argb, double opacity);
CGPathRef NGNCreatePath(const ngn::SvgPath &path);

// A canvas over `context`, whose coordinates are the view's: top left, y down, in points, `size`
// big at `scale` pixels a point. `imageLoaded` runs when an image it was asked for has loaded.
// `viewFor` finds a foreignObject's view by its tag, whose children the canvas draws; without it,
// a foreignObject draws nothing.
std::unique_ptr<ngn::SvgCanvas> NGNMakeCGCanvas(
    CGContextRef context,
    CGSize size,
    CGFloat scale,
    void (^imageLoaded)(void),
    NSView * (^viewFor)(ngn::Tag) = nil);

// Whether the load of an svg image's uri failed, or its data was no image, so that later draws
// skip it. Tests wait on it to know the failure was recorded.
bool NGNSvgImageLoadFailed(const std::string &uri);
