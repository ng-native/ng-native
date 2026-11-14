---
__default__: patch
---

On macOS `ScreenCapture` answers from the desktop host's `NgNativeScreenCapture`: `prevent()` keeps every window of the app, including the ones it opens after, out of screenshots, recordings and screen sharing through `NSWindow.sharingType` until each key is released with `allow()`. `screenshots` stays at zero and `protectAppSwitcher()` does nothing on macOS.
