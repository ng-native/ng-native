---
__default__: patch
---

`<pressable [menu]>` opens a menu of `<menu-item>`s under the element on a press, instead of firing `(press)`: on macOS as an `NSMenu`, and on Linux as a popover menu.

A click, a screen reader's press or, on macOS, Space on the focused element opens it, and `PressMenu.open()` (`#menu="pressMenu"`) opens it from code. A menu of `[checked]` items is a pop-up select. iOS, Android, Expo Go and the web host draw no menu on a press yet: there a press fires `(press)`, with one warning in development. The desktop host's `NgNativeMenus` module has a new `popUpMenu(view, entries)` method for it. A `<menu-item>` with a one-way `[checked]` binding now stays as the app binds it when chosen, rather than toggling on its own, so a menu of choices keeps the one the app keeps checked; a two-way `[(checked)]` still toggles.
