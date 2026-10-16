---
__default__: patch
---

A CSS transition of a size or a place (`width`, `height`, the insets, the margins, `flex-basis`), and a `@keyframes` animation of a size, now animate on Android where layout animations are off, which is React Native's default there and always so in Expo Go, instead of jumping to where they end.

`getFabricUIManager()` reads React Native's `enableLayoutAnimationsOnAndroid` or `enableLayoutAnimationsOnIOS` feature flag for the platform given to `registerPlatformComponents()`, and where it is off, leaves out `configureNextLayoutAnimation`, so the engine eases them from JavaScript, a commit on every frame, as it does on any host with no layout animation. Eased that way, it stalls while JavaScript is busy. An Android app that turns layout animations on, with the `@ng-native/metro` plugin's `android.layoutAnimations` option, still has them played by native.
