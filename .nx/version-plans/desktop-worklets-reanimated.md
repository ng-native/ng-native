---
__default__: patch
---

`@ng-native/desktop` builds `react-native-worklets` and `react-native-reanimated` into the macOS host when the app has them installed: worklets run on the UI thread, and Reanimated's shared values, animations and worklet styles move views at the display's rate, with no frames taken while nothing animates.
