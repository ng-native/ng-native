---
__default__: patch
---

`Keyboard.windowTop` on Android now includes how far down the screen the app's window starts, in the lower half of a split screen or in a freeform window, when `provideNativeKeyboard()` from `@ng-native/expo` is provided.

`<keyboard-avoiding-view>`, a focused `<text-input>` and web-compat's `innerHeight` compared the keyboard's top on the screen with views measured in a window that starts lower down, so they treated the keyboard as lower than it was. A `KeyboardSource` can now report the window's top on the screen as `screenTop`, and the `NgNativeKeyboard` module reads it. Expo Go, and apps without `provideNativeKeyboard()`, still leave it out: React Native has no way to read it.
