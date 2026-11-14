---
__default__: patch
---

`@ng-native/components` has `<menu-bar>`, `<menu-group>`, `<menu-item>` and `<menu-separator>`, `[shortcut]` with `(shortcutPress)`, and `[contextMenu]`, and `@ng-native/device` has the `Menus` service that sends them to a host with the `NgNativeMenus` module. The menu bar is drawn where the host has one, and its shortcuts work from a hardware keyboard elsewhere. A context menu opens on a right-click on macOS, and on a long press or a right-click on Android, where the long press then does not also fire `(longPress)`; iOS does not draw it yet. On Android the shortcuts work from a hardware keyboard and are listed in the Keyboard Shortcuts helper.
