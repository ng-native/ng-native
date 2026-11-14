#import "svg-view.h"
#import "cg-canvas.h"

#include <cmath>
#include <vector>

@implementation NGNSvgView {
  std::shared_ptr<const ngn::SvgDocument> _document;
}

- (void)setDocument:(std::shared_ptr<const ngn::SvgDocument>)document {
  _document = std::move(document);
  [self setNeedsDisplay:YES];
}

- (void)updateLayout:(const facebook::react::LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  [self setNeedsDisplay:YES];
}

- (void)viewDidChangeBackingProperties {
  [super viewDidChangeBackingProperties];
  [self setNeedsDisplay:YES];
}

- (void)drawRect:(NSRect)dirtyRect {
  if (!_document) {
    return;
  }
  CGContextRef context = NSGraphicsContext.currentContext.CGContext;
  NSSize size = self.bounds.size;
  CGFloat scale = self.window ? self.window.backingScaleFactor : NSScreen.mainScreen.backingScaleFactor;
  __weak NGNSvgView *weakSelf = self;
  auto canvas = NGNMakeCGCanvas(context, size, scale, ^{
    [weakSelf setNeedsDisplay:YES];
  });
  CGContextSaveGState(context);
  ngn::drawSvg(*_document, size.width, size.height, *canvas);
  CGContextRestoreGState(context);
}

@end

@implementation NGNSvgElementView

- (instancetype)initWithShadowView:(const facebook::react::ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    self.hidden = YES;
  }
  return self;
}

- (void)setHidden:(BOOL)hidden {
  [super setHidden:YES];
}

@end
