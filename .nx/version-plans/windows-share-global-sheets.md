---
__default__: patch
---

On macOS, a global sheet an app adds with `app.engine.addGlobalSheet()` reaches every window, where it reached only the hidden app surface and drew nothing. A window already open, one opened later, and a sheet replaced or removed all follow, and a window opens with the tokens the app has at that moment, such as the hairline, and takes each `updateTokens` after.
