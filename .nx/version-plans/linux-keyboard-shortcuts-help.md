---
__default__: patch
---

On Linux the app's menu has Keyboard Shortcuts (Ctrl+Shift+?) and Help (F1) beside Preferences, as GNOME's and KDE's apps have them. Keyboard Shortcuts opens a window listing every key the menus take and each `[shortcut]` given a `shortcutLabel`; an app item with `menuRole: 'keyboardShortcuts'` and a handler replaces it. Help shows only when the app gives a `help` item a handler, as Preferences does for `settings`, and that item takes F1 only when it sets `shortcut: 'F1'`. `MenuRole` gains `'keyboardShortcuts'` and `'help'`. macOS's menu bar is unchanged.
