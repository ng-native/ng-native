#import "svg-view.h"
#import "cg-canvas.h"

#include <cmath>
#include <vector>

@implementation NGNSvgView {
  std::shared_ptr<const ngn::SvgDocument> _document;
  // The documents set so far, and whether the next draw is the one after a draw of a
  // foreignObject's views with no document set since: see drawRect.
  uint64_t _documents;
  BOOL _followUp;
}

- (void)setDocument:(std::shared_ptr<const ngn::SvgDocument>)document {
  _document = std::move(document);
  _documents++;
  _followUp = NO;
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

// A foreignObject's view: an element's, under the svg's own and its groups'.
- (NSView *)descendantTagged:(ngn::Tag)tag {
  NSMutableArray<NSView *> *pending = [self.subviews mutableCopy];
  while (pending.count > 0) {
    NSView *view = pending.lastObject;
    [pending removeLastObject];
    if (![view isKindOfClass:NGNSvgElementView.class]) {
      continue;
    }
    if (((NGNView *)view).reactTag == tag) {
      return view;
    }
    [pending addObjectsFromArray:view.subviews];
  }
  return nil;
}

- (void)drawRect:(NSRect)dirtyRect {
  if (!_document) {
    return;
  }
  CGContextRef context = NSGraphicsContext.currentContext.CGContext;
  NSSize size = self.bounds.size;
  CGFloat scale = self.window ? self.window.backingScaleFactor : NSScreen.mainScreen.backingScaleFactor;
  __weak NGNSvgView *weakSelf = self;
  __block BOOL drewViews = NO;
  auto canvas = NGNMakeCGCanvas(
      context,
      size,
      scale,
      ^{
        [weakSelf setNeedsDisplay:YES];
      },
      ^NSView *(ngn::Tag tag) {
        drewViews = YES;
        return [weakSelf descendantTagged:tag];
      });
  CGContextSaveGState(context);
  ngn::drawSvg(*_document, size.width, size.height, *canvas);
  CGContextRestoreGState(context);
  // The views in a foreignObject draw after the svg in the same pass, so a change to one shows in
  // the svg's next draw: that comes on the next turn of the run loop, as react-native-svg's
  // ForeignObject asks for one on iOS, and asks for no other unless something changed first.
  if (drewViews && !_followUp) {
    uint64_t documents = _documents;
    dispatch_async(dispatch_get_main_queue(), ^{
      [weakSelf drawFollowUpOf:documents];
    });
  }
}

- (void)drawFollowUpOf:(uint64_t)documents {
  _followUp = documents == _documents;
  [self setNeedsDisplay:YES];
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
