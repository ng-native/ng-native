---
__default__: patch
---

`Camera` from `@ng-native/expo/camera` gains a `mute` input that sets `<expo-camera>`'s `mute` prop, and the macOS desktop host now honours it, so a muted view records with no audio track on iOS, Android and macOS.

A bare `mute` attribute is true, and `null` or `undefined` leaves the prop unset, with sound. Before, a bare `mute` committed an empty string, which no platform reads as true, and `[mute]` did not compile. On macOS the view's `mute` as `record()` starts holds for that recording; a change while it records applies to the next one. As in expo-camera on iOS, `record()` no longer reads a `mute` option of its own on macOS, which was never part of expo-camera's `CameraRecordingOptions`.
