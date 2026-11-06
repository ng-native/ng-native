---
__default__: patch
---

`ScreenCapture.protectAppSwitcher()` now hides the app's snapshot in recent apps on Android 13 and later without blocking screenshots, where it rejected with an `UnavailabilityError` from `expo-screen-capture`.

It calls `Activity.setRecentsScreenshotEnabled(false)` through this package's native half, and `unprotectAppSwitcher()` calls it with `true`. The setting is applied again to an activity that is recreated while it is on. It needs a development build. On Android before 13, and in Expo Go on Android, both calls now resolve without doing anything. `blurIntensity` is used on iOS only, which is unchanged.
