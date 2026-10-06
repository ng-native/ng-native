---
'__default__': patch
---

The `@ng-native/metro` config plugin takes an `android.layoutAnimations` option that makes `LayoutAnimation.animate()` animate on Android, where every layout change otherwise lands in one step.

React Native 0.86 ships its `enableLayoutAnimationsOnAndroid` feature flag off, and with it off Fabric never hands a commit to the driver that plays a layout animation. With `["@ng-native/metro", { "android": { "layoutAnimations": true } }]` in `app.json`, the plugin turns the flag on in the `MainApplication.kt` that `expo prebuild` writes. The option is off by default, and without it the Android project is as `expo prebuild` wrote it. Expo Go on Android is built with the flag off and does not animate; iOS is unchanged.
