---
__default__: patch
---

A push to a url that is already on the stack pushes a new screen over it, and Back returns to where the push came from, where the push popped to the earlier screen and destroyed everything above it.

`NativeNavigation.popTo(url)` is the way to go back to a screen further down. A back, by gesture, button or `back()`, still returns to the screen that was kept.
