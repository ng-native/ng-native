---
__default__: patch
---

On macOS `AppInfo` answers from the desktop host's `NgNativeApplication` and `NgNativeDevice`: `version`, `build`, `id` and `name` from the app's `Info.plist` (a dev run has no versions, and gives the app's own id and name), and `device` as the Mac's model name, `macOS` and its version, `physical` true and `type` `desktop`.
