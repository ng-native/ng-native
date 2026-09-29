---
__default__: patch
---

`StatusBar` works on iOS 27, where `UIApplication.setStatusBarStyle` is a no-op and React Native's
status bar module does nothing. In an app on `@ng-native/router`, the style and visibility asked
for go on the stack's screens instead, which report them to iOS as their view controllers'
preferred status bar, and the config plugin turns on view-controller-based status bar appearance
for it. Run `npx expo prebuild --clean` after upgrading.
