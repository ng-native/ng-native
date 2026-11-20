---
__default__: patch
---

On the GTK desktop host on Linux, each `<tray-icon>` is a StatusNotifierItem with its menu, which KDE Plasma and GNOME's AppIndicator extension show, and `Tray.available()` is `false` when no StatusNotifierWatcher runs as the app starts; `Dock.available()` is `false` on Linux. The notifications badge count goes out as the Unity launcher entry's count, which KDE Plasma and Ubuntu's dock show. `UndoStack` keeps its history on Linux, where pushing to it no longer crashes the host, and Edit > Undo and Redo (Ctrl+Z and Ctrl+Shift+Z) run it while no text input has the focus. Ctrl+W closes the sheet, cover or popover in front before the window, as Cmd-W does on macOS. A desktop input script's `key` step takes the arrow keys (`left`, `right`, `up`, `down`) on macOS and Linux, and on Linux a test launch with `NGN_CAPTURE` takes its screenshot after its input script has played.
