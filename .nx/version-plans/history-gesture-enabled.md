---
__default__: patch
---

On macOS a screen with `gestureEnabled: false`, from its presentation or its page's host bindings, is not left by the OS's back and forward inputs (a two-finger swipe, Cmd-[ and Cmd-], mouse buttons 4 and 5), as it is not left by a swipe on iOS. `NavigationHistory`'s `back()` and `forward()` from the app still go.
