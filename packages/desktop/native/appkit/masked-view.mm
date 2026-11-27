#import "masked-view.h"

#import <QuartzCore/QuartzCore.h>

using namespace facebook::react;

// The holder and the content: y-down and filling the view, so each child's Yoga frame stands.
@interface NGNMaskedLayer : NSView
@end

@implementation NGNMaskedLayer
- (BOOL)isFlipped {
  return YES;
}
@end

@implementation NGNMaskedView {
  NGNMaskedLayer *_holder;
  NGNMaskedLayer *_content;
  CALayer *_mask;
  NSMutableArray<NGNView *> *_children;
}

+ (NSHashTable<NGNMaskedView *> *)live {
  static NSHashTable *live = [NSHashTable weakObjectsHashTable];
  return live;
}

+ (void)refreshMasks {
  for (NGNMaskedView *view in self.live) {
    [view renderMask];
  }
}

+ (void)contentChangedIn:(NSView *)view {
  // Only a masked view whose mask the change is in: one with it in its content draws it live. That
  // one renders, and its own render tells the masked views around it in turn.
  for (NSView *at = view.superview; at != nil; at = at.superview) {
    if (![at isKindOfClass:NGNMaskedView.class]) {
      continue;
    }
    NGNView *mask = ((NGNMaskedView *)at)->_children.firstObject;
    if (mask != nil && [view isDescendantOf:mask]) {
      [(NGNMaskedView *)at renderMask];
      return;
    }
  }
}

- (instancetype)initWithShadowView:(const ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    _children = [NSMutableArray array];
    _holder = [[NGNMaskedLayer alloc] initWithFrame:self.bounds];
    _holder.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _holder.wantsLayer = YES;
    // Laid out and drawn, so its layer can be rendered, but never seen.
    _holder.alphaValue = 0;
    [self addSubview:_holder];
    _content = [[NGNMaskedLayer alloc] initWithFrame:self.bounds];
    _content.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _content.wantsLayer = YES;
    [self addSubview:_content];
    _mask = [CALayer layer];
    [NGNMaskedView.live addObject:self];
  }
  return self;
}

// The mask first, then the content, wherever each is held.
- (NSArray<NSView *> *)fabricChildren {
  return _children;
}

- (void)mountChild:(NGNView *)child index:(NSInteger)index {
  [_children insertObject:child atIndex:MIN((NSUInteger)MAX(index, 0), _children.count)];
  [self arrange];
}

- (void)unmountChild:(NGNView *)child {
  [_children removeObject:child];
  [child removeFromSuperview];
  [self arrange];
}

// The first child into the holder, the rest into the content, in order.
- (void)arrange {
  for (NSUInteger i = 0; i < _children.count; i++) {
    NGNView *child = _children[i];
    NSView *parent = i == 0 ? _holder : _content;
    if (child.superview != parent) {
      [child removeFromSuperview];
      [parent addSubview:child];
    }
  }
  // The content's own order follows the children's, last on top.
  for (NSUInteger i = 1; i < _children.count; i++) {
    [_content addSubview:_children[i] positioned:NSWindowAbove relativeTo:nil];
  }
  [self renderMask];
}

- (void)viewDidChangeBackingProperties {
  [super viewDidChangeBackingProperties];
  [self renderMask];
}

- (void)layout {
  [super layout];
  [self renderMask];
}

// The first child's layer, at the screen's scale, as the content's mask: where it is opaque the
// content shows. With no first child nothing is masked.
- (void)renderMask {
  NGNView *first = _children.firstObject;
  if (first == nil) {
    _content.layer.mask = nil;
    [NGNMaskedView contentChangedIn:self];
    return;
  }
  NSRect bounds = _content.bounds;
  CGFloat scale = self.window ? self.window.backingScaleFactor : NSScreen.mainScreen.backingScaleFactor;
  size_t width = static_cast<size_t>(ceil(NSWidth(bounds) * scale));
  size_t height = static_cast<size_t>(ceil(NSHeight(bounds) * scale));
  if (width == 0 || height == 0) {
    _mask.contents = nil;
    _content.layer.mask = _mask;
    [NGNMaskedView contentChangedIn:self];
    return;
  }
  [first displayIfNeeded];
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(nullptr, width, height, 8, 0, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  if (context == nullptr) {
    return;
  }
  // y-down, as the views lay out, then to where the first child sits.
  CGContextTranslateCTM(context, 0, static_cast<CGFloat>(height));
  CGContextScaleCTM(context, scale, -scale);
  CGContextTranslateCTM(context, NSMinX(first.frame), NSMinY(first.frame));
  // Moved as it is drawn: its transform is about its corner, which a layer's own render leaves out.
  CGContextConcatCTM(context, CATransform3DGetAffineTransform(first.viewTransform));
  [first.layer renderInContext:context];
  CGImageRef image = CGBitmapContextCreateImage(context);
  CGContextRelease(context);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _mask.frame = _content.layer.bounds;
  _mask.contentsScale = scale;
  _mask.contents = (__bridge id)image;
  _mask.contentsGravity = kCAGravityResize;
  _content.layer.mask = _mask;
  [CATransaction commit];
  if (image != nullptr) {
    CGImageRelease(image);
  }
  // A masked view around this one, which may mask with it, renders after it: inner masks first,
  // whichever order a refresh takes them in.
  [NGNMaskedView contentChangedIn:self];
}

@end
