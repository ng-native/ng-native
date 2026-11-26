---
__default__: patch
---

A `<pressable [menu]>` now opens its menu on Android, as a PopupMenu below the element, on a tap, a TalkBack press, Space, Enter or the D-pad centre, and from `open()`, with checked items shown checked.

It takes the `NgNativeMenus` module's new `popUpMenu(view, entries)`, with the view's tag as on the desktop host, which a development build has and Expo Go does not; in Expo Go a press still fires `(press)`, with one warning in development. The module finds the view in whichever window it is in, so a pressable inside a `<modal>` opens its menu too. iOS still fires `(press)` with the warning.
