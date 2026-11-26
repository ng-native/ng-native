---
__default__: patch
---

`<expo-blur-target>` and `<expo-blur [blurTarget]>` give `<expo-blur>` on Android the content it blurs, as `expo-blur`'s `BlurTargetView` and `blurTarget` do.

Register the target with `registerExpoViews('expo-blur-target')`. On Android it is `expo-blur`'s `ExpoBlurTargetView`, and the blur commits its view tag as `blurTargetId`, which blurs with a `blurMethod` other than `none`. On iOS and macOS the target is a plain view. An Expo view registration can now name no view for a platform, which commits a plain view there.
