---
__default__: patch
---

`@ng-native/device` adds `UndoStack`, which puts the app's own actions on the OS's undo manager (NSUndoManager on macOS, UIUndoManager on iOS and iPadOS), so Edit > Undo and Redo, mod+z and shake to undo take them back while no text input has focus. It is absent on Android and in the web host. `@ng-native/testing` adds `fakeUndo()`, which `provideDesktopFakes()` provides.
