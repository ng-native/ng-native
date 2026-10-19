---
__default__: patch
---

`DeepLinks` from `@ng-native/device` has `follow(path)`, which hands a path of the app's own to its listeners as a link that arrived from outside is handed, so the router navigates to it. In an app with no listener, such as one without `provideNativeRouter()`, the path goes nowhere.

`NATIVE_HISTORY` from `@ng-native/device` is the `PlatformLocation` that `provideNativeRouter()` provides; a fallback `PlatformLocation`, such as web-compat's, yields to it when both are present.
