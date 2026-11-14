---
__default__: patch
---

On macOS `splashScreen` answers from the desktop host's `NgNativeSplashScreen`: `hold()` keeps the app's first windows hidden past their first frame, and `hide()` or `hideWhenReady()` shows them. A hold after a window has already shown does nothing.
