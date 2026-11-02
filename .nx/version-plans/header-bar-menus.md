---
__default__: patch
---

In `@ng-native/router`, a bar button `<native-header-item>` takes a `[menu]` that opens a native `UIMenu` on iOS and reports the action chosen through `(menuSelect)`, and an item with a `[spacing]` is a fixed gap among the bar buttons on iOS.

The new types are `HeaderMenu`, `HeaderMenuAction` and `HeaderSubmenu`. A tap on a bar button with a menu opens the menu rather than sending `(press)`. Android's header draws neither, and its one development warning for bar buttons now names them. The header has no flexible spacer.
