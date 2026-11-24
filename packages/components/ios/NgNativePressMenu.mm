#import "NgNativePressMenu.h"

/** React Native's view holds its children in a view of its own while its style clips overflow ink. */
@interface UIView (NgNativeContainerView)
- (UIView *)currentContainerView;
@end

@implementation NgNativePressMenuButton {
  NgNativeMenuChoose _choose;
}

- (instancetype)initWithChoose:(NgNativeMenuChoose)choose
{
  if (self = [super initWithFrame:CGRectZero]) {
    _choose = [choose copy];
    _entries = @[];
    self.backgroundColor = UIColor.clearColor;
    self.showsMenuAsPrimaryAction = YES;
    self.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    // React Native's view is the accessibility element, with the app's label, role and state;
    // VoiceOver's activation of it taps its middle, which lands here.
    self.isAccessibilityElement = NO;
  }
  return self;
}

- (void)setEntries:(NSArray *)entries
{
  _entries = [entries copy];
  self.menu = [UIMenu menuWithTitle:@"" children:NgNativeMenuElements(_entries, _choose, NULL)];
}

@end

NgNativePressMenuButton *NgNativeAddPressMenu(UIView *view, NSArray *entries, NgNativeMenuChoose choose)
{
  // React Native hit-tests only the children of the view that holds them, and moves every child
  // with it as that view comes and goes, so the button stays in it, last.
  UIView *holder = [view respondsToSelector:@selector(currentContainerView)] ? view.currentContainerView : view;
  NgNativePressMenuButton *button = [[NgNativePressMenuButton alloc] initWithChoose:choose];
  button.entries = entries;
  button.frame = holder.bounds;
  [holder addSubview:button];
  return button;
}
