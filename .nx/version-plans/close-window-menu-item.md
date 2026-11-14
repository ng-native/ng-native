---
__default__: patch
---

The default macOS menu bar has Close Window (Cmd-W, `menuRole` `close`) at the top of the Window menu. An app whose `<menu-bar>` has a `<menu-group menuRole="file">` gets it at the end of that File menu instead, and an app `<menu-item menuRole="close">` replaces it.
