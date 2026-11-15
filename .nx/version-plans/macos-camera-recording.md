---
__default__: patch
---

On macOS, `Camera.record()` no longer ends the app as the recording starts, and resolves once the recording stops (at `maxDuration` or `maxFileSize`, or on `stopRecording()`), where before the promise never settled. The camera view skips a suspended camera, such as a MacBook's built-in one with the lid closed, for another camera, or reports that the Mac has no camera, where before it showed nothing and `takePicture()` never answered.
