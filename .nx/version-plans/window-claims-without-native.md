---
__default__: patch
---

Where a native module is not there, as on the web host or in Node tests, each app keeps its own window claims, so the claims of an app that is never destroyed no longer show in every app mounted after it. This covers `Brightness`, `KeepAwake` and `ScreenCapture` without their Expo modules, `DeviceOrientation` without `expo-screen-orientation`, `StatusBar` without React Native, and `NavigationBar` off Android or without `expo-navigation-bar`.
