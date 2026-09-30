---
__default__: patch
---

`StatusBar` changes the bar again in an app built with the iOS 27 SDK, where UIKit ignores the app-wide setters React Native's status bar module calls. `@ng-native/metro`'s config plugin now answers those calls from the view controllers iOS asks, the window's root and a screen or React Native modal presented full screen, and sets `UIViewControllerBasedStatusBarAppearance`. `expo-status-bar` and React Native's own `StatusBar` work again too. Until the app claims a style or visibility, a screen's own `statusBarStyle` and `statusBarHidden` apply. An existing app picks it up with `npx expo prebuild --clean`.
