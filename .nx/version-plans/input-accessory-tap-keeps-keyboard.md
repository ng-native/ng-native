---
'__default__': patch
---

On iOS a tap on an `<input-accessory-view>` written inside a `<scroll-view>` or a list no longer dismisses the keyboard.

The bar is drawn above the keyboard, outside the scroll view, so a tap on it that no control takes (a disabled button, the space between two) is not a tap outside the field, as in UIKit. The scroll view's `keyboardShouldPersistTaps` handling dismissed the keyboard for it, as React Native's own `ScrollView` does; this diverges from React Native on purpose. On Android, where the element is a plain view, a tap on it dismisses the keyboard as before.
