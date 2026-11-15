#import "apple-button-view.h"

#import "apple-id-button.h"

@implementation NGNAppleButtonView {
  NGNAppleIdButton *_button;
}

- (instancetype)initWithShadowView:(const facebook::react::ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    __weak NGNAppleButtonView *weakSelf = self;
    _button = [[NGNAppleIdButton alloc] initWithFrame:self.bounds pressed:[weakSelf] { [weakSelf press]; }];
    _button.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:_button];
  }
  return self;
}

- (void)press {
  if (auto emitter = self.eventEmitter) {
    emitter->dispatchEvent("buttonPress", folly::dynamic::object(), facebook::react::RawEvent::Category::Discrete);
  }
}

- (void)updateProps:(const facebook::react::Props::Shared &)props {
  [super updateProps:props];
  if (auto button = std::dynamic_pointer_cast<const ngn::AppleButtonProps>(props)) {
    [_button applyType:button->buttonType style:button->buttonStyle cornerRadius:button->cornerRadius];
  }
}

- (void)layout {
  [super layout];
  _button.frame = self.bounds;
}

@end
