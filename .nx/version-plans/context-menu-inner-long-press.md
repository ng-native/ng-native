---
__default__: patch
---

On Android, a `<pressable>` with its own `(longPress)` inside an element with a `[contextMenu]` keeps its long press, and its `(press)`: a long press there opens no menu, as the innermost handler wins in a native app, and a right-click there still opens the menu. A `<pressable>` with a `(longPress)` around an element with a `[contextMenu]` leaves a long press on that element to the menu on Android and iOS, whatever its `delayLongPress`. A context menu on Android opens after the system's long-press timeout, which follows the Touch & hold delay setting, and TalkBack opens it with the element's long-press action. On Android a shortcut on a shifted character, such as `mod+?` or `mod+shift+?`, fires, and a shortcut does not fire while a `<modal>` is open.
