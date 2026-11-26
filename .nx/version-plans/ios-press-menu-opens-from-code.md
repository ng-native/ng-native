---
__default__: patch
---

On iOS 17.4 and later, `PressMenu.open()` opens a `<pressable [menu]>`'s menu from code, and a tap made on the element before its menu is ready opens the menu instead of doing nothing.

A touch still opens the menu as it goes down, as SwiftUI's `Menu` does. From iOS 17.4 the `NgNativeMenus` module has `openPressMenu(nativeID)`, and its constants say so with `opensPressMenus`; it does nothing while the menu is already showing. A tap that the element takes before the clear button that opens the menu is laid over it now makes the module look for the element's view at once and open the menu. Before, that tap did nothing, and for an element shown after it was mounted the button could take up to 2 s to be laid. Before iOS 17.4, `open()` still returns false, with one warning in development.
