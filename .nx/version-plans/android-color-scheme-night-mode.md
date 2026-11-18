---
__default__: patch
---

`ColorScheme.set` on Android 12 and later also sets the app's night mode through `UiModeManager.setApplicationNightMode`, so native views drawn after the change, such as Compose sliders, use the chosen scheme instead of the system's.

React Native's `Appearance.setColorScheme` sets only AppCompat's default night mode, which the system overwrote on activities that handle `uiMode` themselves, as Expo's do, while the CSS kept the chosen scheme. The new `NgNativeColorScheme` module ships in `@ng-native/components` and needs a native rebuild; Expo Go keeps the old behaviour. On Android 12 and later the system now keeps the scheme across launches until `set()` or `set(null)` changes it; iOS and earlier Android are unchanged.
