---
__default__: patch
---

The types of `@ng-native/components/reanimated` and `/gestures` no longer import `react-native-reanimated` or `react-native-gesture-handler`, so a browser app that installs neither now type-checks with `skipLibCheck: false`, and `sharedValue()` keeps its type there where it was `any`.

`sharedValue()` now returns a `MutableValue<T>`, which has the shape of Reanimated's public `SharedValue` and is still accepted wherever Reanimated takes one. In `@ng-native/testing`, a shared value now also has `modify()`, `addListener()` and `removeListener()`, as Reanimated's does.
