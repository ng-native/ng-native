---
'__default__': patch
---

`Keyboard.windowTop` in `@ng-native/device` is read from where React Native measures the app's root, so `<keyboard-dock>`, `<keyboard-avoiding-view>`, a focused `<text-input>` and `provideWebCompat()`'s window stay against the keyboard when the status bar is hidden or shown while it is up, on Android with React Native's edge-to-edge flag off (as in Expo Go). React Native keeps measuring from below where the bar was until the app's root is laid out again, while the bar's own height changed at once; the dock dropped behind the keyboard by the bar's height when the bar was hidden.
