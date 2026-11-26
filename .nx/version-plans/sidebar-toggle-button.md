---
__default__: patch
---

`<sidebar>` takes `[toggleButton]="false"`, which leaves the sidebar button out of the window's toolbar on macOS and its header bar on Linux, for an app that draws its own.

View > Show Sidebar, its shortcut and `[(collapsed)]` still work. On macOS the toolbar keeps its sidebar tracking separator. iOS, Android and the web host ignore it.
