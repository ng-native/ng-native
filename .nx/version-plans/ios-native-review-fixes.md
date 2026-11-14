---
__default__: patch
---

On an iPad, a `<menu-item>` whose shortcut UIKit's own menus already have (a handled `find` on mod+f, say), or that an earlier item of the app has, goes into the menu bar without the shortcut, where it crashed the app before. On iOS, `UndoStack` keeps only the app's actions on the shared undo manager: a view with an undo history of its own keeps its window's while it has focus, and `clear()` or a reload no longer removes that view's actions.
