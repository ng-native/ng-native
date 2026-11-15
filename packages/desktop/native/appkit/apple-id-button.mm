#import "apple-id-button.h"

@implementation NGNAppleIdButton {
  std::function<void()> _pressed;
  ASAuthorizationAppleIDButton *_control;
  int _type;
  int _style;
}

- (instancetype)initWithFrame:(NSRect)frame pressed:(std::function<void()>)pressed {
  if ((self = [super initWithFrame:frame])) {
    _pressed = std::move(pressed);
    _type = -1;
    _style = -1;
  }
  return self;
}

- (ASAuthorizationAppleIDButton *)control {
  return _control;
}

- (void)applyType:(int)type style:(int)style cornerRadius:(double)cornerRadius {
  if (type != _type || style != _style) {
    _type = type;
    _style = style;
    [_control removeFromSuperview];
    _control = [[ASAuthorizationAppleIDButton alloc] initWithAuthorizationButtonType:static_cast<ASAuthorizationAppleIDButtonType>(type)
                                                            authorizationButtonStyle:static_cast<ASAuthorizationAppleIDButtonStyle>(style)];
    _control.frame = self.bounds;
    _control.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _control.target = self;
    _control.action = @selector(press:);
    [self addSubview:_control];
  }
  _control.cornerRadius = cornerRadius;
}

- (void)layout {
  [super layout];
  _control.frame = self.bounds;
}

- (void)press:(id)sender {
  if (_pressed) {
    _pressed();
  }
}

@end
