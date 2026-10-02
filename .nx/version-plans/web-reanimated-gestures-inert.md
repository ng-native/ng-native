---
__default__: patch
---

A browser app on `@ng-native/web` that imports `@ng-native/components/reanimated` or `@ng-native/components/gestures` now builds and runs, with the worklet and gesture directives inert, where it used to fail the build.

Both entry points have a `browser` condition in `exports`, as `@ng-native/components/animations` does, and a browser build resolves them to files that reach neither Reanimated nor Gesture Handler. `WorkletStyle`, `WorkletScroll` and `NativeGesture` take their input and do nothing, `<gesture-root>` is a box that fills its parent (`@ng-native/web`'s reset gives it the `flex: 1` it has on a device), and `sharedValue()` is a plain holder with Reanimated's `value`, `get()`, `set()`, `modify()`, `addListener()` and `removeListener()`. Metro on a device never sets the `browser` condition, so iOS and Android load the same files as before, and the types are unchanged. `Gesture` and Reanimated's own functions, imported from the libraries themselves, still fail a browser build.
