---
__default__: patch
---

New apps from `@ng-native/template`, `ng add @ng-native/schematics` and `@ng-native/nx`'s `application` generator now get `react-native` 0.88.1, which the newest Expo SDK 58 patches expect, so they no longer crash at launch on iOS with `Symbol not found: _OBJC_CLASS_$_RCTStatusBarAppearance`.

`expo@58.0.24` and later bring `expo-modules-core@58.1.0`, which links a class React Native 0.88.0 does not have. An existing app on `react-native` 0.88.0 that installs one of those Expo patches crashes the same way on iOS: run `npx expo install --fix`, then regenerate `ios/` with `npx expo prebuild -p ios --clean`. The generators keep a workspace's own `react-native` 0.88.x without a warning.
