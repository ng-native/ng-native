---
__default__: patch
---

`@ng-native/components` has `<menu-bar>`, `<menu-group>`, `<menu-item>` and `<menu-separator>`, `[shortcut]` with `(shortcutPress)`, and `[contextMenu]`, and `@ng-native/device` has the `Menus` service that sends them to a host with the `NgNativeMenus` module. The menu bar is drawn where the host has one, and its shortcuts work from a hardware keyboard elsewhere. On iOS and Android a `<pressable>` with a context menu does not fire `(longPress)`, since a long press opens the menu.
