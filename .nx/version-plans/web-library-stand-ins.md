---
__default__: patch
---

A browser build through `ngNativeWeb()` now resolves `react-native-reanimated`, `react-native-worklets` and `react-native-gesture-handler` to inert stand-ins, so a component that imports `Gesture`, `withTiming` or `scheduleOnRN` builds for the web as well as for a device.

The stand-ins are `@ng-native/components/stand-ins/reanimated`, `/worklets` and `/gesture-handler`, and `@ng-native/testing` now uses the same ones, so it lists `@ng-native/components` as a peer dependency. On the web an animation lands where it ends and calls its callback with `true` at once, a gesture recognises nothing, and work scheduled for either runtime runs at once.
