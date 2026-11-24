// The ink a view's text draws, for the tests of what `-webkit-font-smoothing` does to a control's
// text (text-layout.test.mm measures a paragraph's the same way).
#pragma once

#import <AppKit/AppKit.h>

#include <cstdint>
#include <vector>

namespace ngn::test {

struct Ink {
  // How dark the view is, summed over its pixels: thinner text is less.
  long total = 0;
  // The pixels neither white nor black, which only antialiased text draws.
  int partial = 0;
};

// What `view` draws, black on white at 2x, into a context with font smoothing allowed and on, as a
// window's context has it.
inline Ink inkOf(NSView *view) {
  const int width = static_cast<int>(NSWidth(view.bounds) * 2), height = static_cast<int>(NSHeight(view.bounds) * 2);
  std::vector<uint8_t> pixels(static_cast<size_t>(width * height * 4), 0);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(pixels.data(), width, height, 8, width * 4, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  CGContextSetRGBFillColor(context, 1, 1, 1, 1);
  CGContextFillRect(context, CGRectMake(0, 0, width, height));
  CGContextScaleCTM(context, 2, 2);
  CGContextSetAllowsFontSmoothing(context, true);
  CGContextSetShouldSmoothFonts(context, true);
  [view displayRectIgnoringOpacity:view.bounds inContext:[NSGraphicsContext graphicsContextWithCGContext:context flipped:NO]];
  CGContextRelease(context);
  Ink ink;
  for (size_t i = 0; i < pixels.size(); i += 4) {
    ink.total += 255 - pixels[i];
    ink.partial += pixels[i] != 0 && pixels[i] != 255;
  }
  return ink;
}

} // namespace ngn::test
