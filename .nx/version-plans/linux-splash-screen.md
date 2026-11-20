---
__default__: patch
---

`splashScreen.hold()` works on Linux: the GTK host keeps the app's first windows hidden past their first frame until `hide()`, as the macOS host does, and a reload lets them go.

On macOS and Linux, a reload asked for by `DevSettings.reload()`, the dev server or the debugger goes through the host's own reload, which holds the app's surfaces still while it runs. A window shown or resized during such a reload no longer crashes the host, as one the splash screen let go did on Linux.
