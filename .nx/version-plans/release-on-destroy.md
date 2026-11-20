---
__default__: patch
---

`releaseOnDestroy` in `@ng-native/components` and `@ng-native/components/reanimated` wraps a function a worklet calls back, such as a `scheduleOnRN` target, so that native code keeping the worklet does not keep the component too.

react-native-worklets keeps such a function from native code after the gesture is detached, so one that reached its component kept the component and its view tree for the rest of the app's life. The function `releaseOnDestroy` returns calls the one it was given until the component, or the `DestroyRef` passed to it, is destroyed, and then does nothing.

The stand-in document that `mount` in `@ng-native/platform` gives Angular no longer keeps the last app reachable after it is destroyed, so a component that a `render()` in `@ng-native/testing` has unmounted can be garbage-collected, with its engine and fake Fabric.
