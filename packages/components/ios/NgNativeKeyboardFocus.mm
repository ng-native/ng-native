#import "NgNativeKeyboardFocus.h"

static NSMutableSet<NSNumber *> *focusableTags(void)
{
  static NSMutableSet<NSNumber *> *tags = [NSMutableSet set];
  return tags;
}

void NgNativeSetKeyboardFocusable(NSInteger tag, BOOL focusable)
{
  if (focusable) {
    [focusableTags() addObject:@(tag)];
  } else {
    [focusableTags() removeObject:@(tag)];
  }
}

BOOL NgNativeKeyboardFocusable(NSInteger tag)
{
  return [focusableTags() containsObject:@(tag)];
}

BOOL NgNativeKeyPresses(UIKeyboardHIDUsage key, UIKeyModifierFlags modifiers)
{
  BOOL pressing = key == UIKeyboardHIDUsageKeyboardSpacebar || key == UIKeyboardHIDUsageKeyboardReturnOrEnter ||
      key == UIKeyboardHIDUsageKeypadEnter;
  return pressing && (modifiers & ~(UIKeyModifierAlphaShift | UIKeyModifierNumericPad)) == 0;
}
