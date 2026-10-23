---
'__default__': patch
---

`provideNativeKeyboard()` in `@ng-native/expo` reports where the keyboard stopped when the app started listening while the keyboard was already moving on Android. `Keyboard.height` and `Keyboard.metrics` took that position only at the keyboard's next motion before, staying at zero until then.
