// Core Graphics under the core's SvgCanvas: the svg view draws its document with it, and every
// view draws its box (ngn/view-box.h) with it.
#pragma once

#import <AppKit/AppKit.h>

#include "ngn/svg.h"

#include <memory>

// Both answer a +1 reference the caller releases.
CGColorRef NGNCreateColor(uint32_t argb, double opacity);
CGPathRef NGNCreatePath(const ngn::SvgPath &path);

// A canvas over `context`, whose coordinates are the view's: top left, y down, in points, `size`
// big at `scale` pixels a point. `imageLoaded` runs when an image it was asked for has loaded.
std::unique_ptr<ngn::SvgCanvas> NGNMakeCGCanvas(CGContextRef context, CGSize size, CGFloat scale, void (^imageLoaded)(void));
