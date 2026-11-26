---
__default__: patch
---

A `<pressable [menu]>` now opens its menu on iOS, as a UIMenu from the element on a touch or a VoiceOver press, with checked items shown checked, instead of firing `(press)` with a warning.

It takes the `NgNativeMenus` module's new `setPressMenu(nativeID, entries)`, which a development build has and Expo Go does not; in Expo Go a press still fires `(press)`, with one warning in development. The module lays a clear `UIButton` over the element's view, which UIKit opens the menu from, and takes it away while the pressable is disabled or once `[menu]` shows no item. UIKit has no way to open a menu from code, so on iOS `open()` returns false, with one warning in development.
