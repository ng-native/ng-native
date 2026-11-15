#import "glass-view.h"

#import "glass-effect.h"

using namespace facebook::react;

// The children's container: y-down, as every view the host mounts into.
@interface NGNGlassContent : NSView
@end

@implementation NGNGlassContent
- (BOOL)isFlipped {
  return YES;
}
@end

@implementation NGNGlassView {
  NSView *_effect;
  NGNGlassContent *_content;
  std::optional<ngn::Glass> _glass;
}

- (instancetype)initWithShadowView:(const ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    _content = [[NGNGlassContent alloc] initWithFrame:self.bounds];
    _content.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:_content];
  }
  return self;
}

- (NSView *)contentContainer {
  return _content;
}

- (void)updateProps:(const Props::Shared &)props {
  [super updateProps:props];
  auto glass = std::dynamic_pointer_cast<const ngn::GlassProps>(props);
  _glass = glass ? ngn::glassOf(*glass) : std::nullopt;
  [self updateGlass];
}

- (void)updateLayout:(const LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  [self updateGlass];
}

// The material for the props now, in the view's top-left corner radius, or none.
- (void)updateGlass {
  if (!_glass) {
    [_effect removeFromSuperview];
    _effect = nil;
    return;
  }
  auto viewProps = std::dynamic_pointer_cast<const ViewProps>(self.props);
  CGFloat radius = viewProps ? viewProps->resolveBorderMetrics(self.layoutMetrics).borderRadii.topLeft.horizontal : 0;
  if (_effect == nil) {
    _effect = ngn::appkit::makeGlassEffect(*_glass, ngn::appkit::liquidGlassAvailable());
    _effect.frame = self.bounds;
    [self addSubview:_effect positioned:NSWindowBelow relativeTo:_content];
  }
  ngn::appkit::updateGlassEffect(_effect, *_glass, radius);
}

@end
