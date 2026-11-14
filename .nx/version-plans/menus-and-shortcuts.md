---
__default__: patch
---

`@ng-native/components` has `<menu-bar>`, `<menu-group>`, `<menu-item>` and `<menu-separator>`, `[shortcut]` with `(shortcutPress)`, and `[contextMenu]`, and `@ng-native/device` has the `Menus` service that sends them to a host with the `NgNativeMenus` module. The menu bar is drawn where the host has one, and its shortcuts work from a hardware keyboard elsewhere. A context menu opens on a right-click on macOS; iOS and Android do not draw it yet.
