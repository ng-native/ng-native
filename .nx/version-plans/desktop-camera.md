---
__default__: patch
---

On macOS the desktop host draws `<expo-camera>` with AVFoundation and `Camera.takePicture()` takes a JPEG through its `NgNativeCamera`, once the camera is allowed. The view skips a suspended camera, such as a MacBook's built-in one with the lid closed, for another camera. A Mac with no camera, or no permission, sends `mountError`.
