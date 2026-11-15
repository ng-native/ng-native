---
__default__: patch
---

`ng-native-desktop` finds the native code the macOS build compiles in, as Expo's autolinking does: a library whose `expo-module.config.json` lists `macos` and names its `macos.cmakeTarget` (and `macos.cmakeDir`, `desktop` by default), and the app's own `modules/<name>/macos/` folders, leaving out what the plugin options' `deny` lists. It warns about dependencies with native code for iOS or Android and none for the desktop, whose native modules are absent on macOS.
