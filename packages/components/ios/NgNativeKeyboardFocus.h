// What an iPad's hardware keyboard can focus among React Native's views, which take no part in
// UIKit's focus system on their own: React Native's iOS props have no `focusable`. A view that
// commits `focusable: true` is reported by react tag (the NgNativeKeyboardFocus module); the hooks
// on RCTViewComponentView let it be focused, draw the focus halo, and press it on Space and Return
// with the touch a tap would send. The parts here run without React Native.
#pragma once

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

// Whether the view with react tag `tag` takes the keyboard's focus. Forgotten as React Native
// recycles the view. Main thread.
void NgNativeSetKeyboardFocusable(NSInteger tag, BOOL focusable);
BOOL NgNativeKeyboardFocusable(NSInteger tag);

// Whether `key`, with `modifiers` held, presses the focused view: Space, Return or the keypad's
// Enter, with nothing held but Caps Lock.
BOOL NgNativeKeyPresses(UIKeyboardHIDUsage key, UIKeyModifierFlags modifiers);

NS_ASSUME_NONNULL_END
