#import "visual-effect-view.h"

#import "visual-effect.h"

using namespace facebook::react;

// The children's container: y-down, as every view the host mounts into.
@interface NGNVisualEffectContent : NSView
@end

@implementation NGNVisualEffectContent
- (BOOL)isFlipped {
  return YES;
}
@end

@implementation NGNVisualEffectView {
  NSVisualEffectView *_effect;
  NGNVisualEffectContent *_content;
  ngn::VisualEffect _visualEffect;
}

- (instancetype)initWithShadowView:(const ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    _effect = [[NSVisualEffectView alloc] initWithFrame:self.bounds];
    _effect.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:_effect];
    _content = [[NGNVisualEffectContent alloc] initWithFrame:self.bounds];
    _content.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:_content];
    [self updateEffect];
  }
  return self;
}

- (NSView *)contentContainer {
  return _content;
}

- (void)updateProps:(const Props::Shared &)props {
  [super updateProps:props];
  auto effect = std::dynamic_pointer_cast<const ngn::VisualEffectProps>(props);
  _visualEffect = effect ? ngn::visualEffectOf(*effect) : ngn::VisualEffect{};
  [self updateEffect];
}

- (void)updateLayout:(const LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  [self updateEffect];
}

// The material for the props now, in the view's top-left corner radius.
- (void)updateEffect {
  auto viewProps = std::dynamic_pointer_cast<const ViewProps>(self.props);
  CGFloat radius = viewProps ? viewProps->resolveBorderMetrics(self.layoutMetrics).borderRadii.topLeft.horizontal : 0;
  ngn::appkit::applyVisualEffect(_effect, _visualEffect, radius);
}

@end
