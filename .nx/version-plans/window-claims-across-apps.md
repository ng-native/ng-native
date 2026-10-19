---
__default__: patch
---

`StatusBar`, `NavigationBar`, `KeepAwake`, `DeviceOrientation`, `Brightness` and `ScreenCapture` keep one stack of claims for every app the runtime mounts, and an app's claims leave it when the app is destroyed, so an app destroyed after another app has claimed leaves what that app claimed.

On Android, each of them also gives an activity that comes to the front, a recreated one included, what is claimed again, so after a font size or display size change the screen still stays awake and out of screen capture where an app holds it. `ScreenCapture.prevent()` holds its key until `allow()` or until the app is destroyed. `@ng-native/device` exports `WindowClaims`, `TopClaim`, `sharedBySource` and `onWindowFront`, which these services are built on.
