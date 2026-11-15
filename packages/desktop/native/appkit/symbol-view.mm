#import "symbol-view.h"

#include "symbol-drawing.h"

@implementation NGNSymbolView

- (void)updateProps:(const facebook::react::Props::Shared &)props {
  [super updateProps:props];
  [self setNeedsDisplay:YES];
}

- (void)updateLayout:(const facebook::react::LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  [self setNeedsDisplay:YES];
}

- (void)viewDidChangeEffectiveAppearance {
  [super viewDidChangeEffectiveAppearance];
  // The label colour an untinted symbol takes follows light and dark.
  [self setNeedsDisplay:YES];
}

- (void)drawRect:(NSRect)dirtyRect {
  auto props = std::dynamic_pointer_cast<const ngn::SymbolProps>(self.props);
  if (!props) {
    return;
  }
  [self.effectiveAppearance performAsCurrentDrawingAppearance:^{
    ngn::appkit::drawSymbol(NSGraphicsContext.currentContext.CGContext, *props, self.bounds.size);
  }];
}

@end
