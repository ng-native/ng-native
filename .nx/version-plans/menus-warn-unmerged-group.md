---
__default__: patch
---

On macOS and iPadOS, where the app's menu bar is drawn, a `<menu-group>` named as a default menu (such as `label="File"`) with no `menuRole`, which is drawn as a second menu of that name, now logs a warning saying so, and that `menuRole="file"` adds its items to the File menu instead.
