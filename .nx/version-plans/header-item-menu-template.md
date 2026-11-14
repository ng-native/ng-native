---
__default__: patch
---

`<native-header-item [menu]>` in `@ng-native/router` takes a template of `<menu-item>`s, `<menu-group>`s and `<menu-separator>`s, as `[contextMenu]` and `<menu-bar>` do: a group is a submenu, or with `inline` a section, a separator starts a section, a `[(checked)]` item shows its state, and the chosen item's `(select)` runs. The `HeaderMenu` object and `(menuSelect)` keep working. `buildMenuTemplate`, `treeOrder` and `menuModelInTreeOrder` are in `@ng-native/device`, and `@ng-native/components` still exports `treeOrder`.
