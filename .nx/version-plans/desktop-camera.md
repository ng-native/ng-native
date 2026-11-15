---
__default__: patch
---

On macOS the desktop host draws `<expo-camera>` with AVFoundation and `Camera.takePicture()` takes a JPEG through its `NgNativeCamera`, once the camera is allowed. A Mac with no camera, or no permission, sends `mountError`. `record()` rejects on macOS.
