---
__default__: patch
---

`DeepLinks` from `@ng-native/device` has `follow(path)`, which hands a path of the app's own to its listeners as a link that arrived from outside is handed, so the router navigates to it.

`NATIVE_HISTORY` from `@ng-native/device` is the native router's `PlatformLocation`, which `provideNativeRouter()` provides, so a package that stands one in for an app with no router keeps the router's.
