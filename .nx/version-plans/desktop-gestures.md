---
__default__: patch
---

`@ng-native/desktop` recognises `react-native-gesture-handler`'s gestures on macOS: pan, tap, long press, fling, hover, manual and native view handlers from the mouse, a pan that asks for it from a trackpad's two-finger scroll, and pinch and rotation from the trackpad, with their relations (`simultaneousWithExternalGesture`, `requireExternalGestureToFail`, `blocksExternalGesture`). Worklet gestures run on the UI thread through Reanimated.
