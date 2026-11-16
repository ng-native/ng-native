---
__default__: patch
---

On macOS `Camera.record()` from `@ng-native/expo` records a QuickTime movie from `<expo-camera>` and resolves once the recording stops, on `stopRecording()`, `maxDuration` or `maxFileSize`. It has sound only when the microphone is already allowed and the view is not muted; the host never asks for the microphone.
