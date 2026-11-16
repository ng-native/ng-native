---
__default__: patch
---

On macOS `ScreenCapture` answers from the desktop host's `NgNativeScreenCapture`: `prevent()` asks macOS to keep every window of the app, including the ones it opens after, out of screenshots, recordings and screen sharing through `NSWindow.sharingType` until each key is released with `allow()`. This is best effort: from macOS 15, an app capturing through ScreenCaptureKit can still capture those windows. `screenshots` stays at zero and `protectAppSwitcher()` does nothing on macOS.
