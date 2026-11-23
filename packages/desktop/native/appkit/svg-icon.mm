#import "svg-icon.h"

#import "cg-canvas.h"

#include "ngn/svg-markup.h"

#include <cmath>
#include <memory>

NSImage *NGNSvgTemplateImage(const std::string &markup, CGFloat size) {
  if (markup.empty() || size <= 0) {
    return nil;
  }
  // ponytail: an app's icons are a few dozen, and NSCache lets go of them under memory pressure.
  static NSCache<NSString *, NSImage *> *images = [NSCache new];
  NSString *key = [NSString stringWithFormat:@"%g %s", size, markup.c_str()];
  if (NSImage *image = [images objectForKey:key]) {
    return image;
  }
  auto parsed = ngn::parseSvgMarkup(markup);
  if (!parsed) {
    return nil;
  }
  // Black, keeping each paint's opacity: a template image is read for its alpha alone.
  auto document = std::make_shared<const ngn::SvgDocument>(ngn::svgPaintedIn(*parsed, 0xff000000));
  NSImage *image = [NSImage imageWithSize:NSMakeSize(size, size)
                                  flipped:YES
                           drawingHandler:^BOOL(NSRect rect) {
                             CGContextRef context = NSGraphicsContext.currentContext.CGContext;
                             CGFloat scale = std::abs(CGContextConvertSizeToDeviceSpace(context, CGSizeMake(1, 1)).width);
                             auto canvas = NGNMakeCGCanvas(context, rect.size, scale > 0 ? scale : 1, nil);
                             ngn::drawSvg(*document, rect.size.width, rect.size.height, *canvas);
                             return YES;
                           }];
  [image setTemplate:YES];
  [images setObject:image forKey:key];
  return image;
}
