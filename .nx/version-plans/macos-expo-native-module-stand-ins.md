---
__default__: patch
---

`@ng-native/metro` gives a `macos` bundle's `expo` the functions Expo's own libraries import as they load (`requireNativeModule`, `requireNativeView` and the rest), inert until used. `@expo/ui`'s modifiers, which call `requireNativeModule('ExpoUI')` on import, failed to load on macOS with "undefined is not a function".
