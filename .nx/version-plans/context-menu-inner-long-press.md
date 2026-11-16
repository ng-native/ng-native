---
__default__: patch
---

On Android, a `<pressable>` with its own `(longPress)` inside an element with a `[contextMenu]` keeps its long press, and its `(press)`: a long press there opens no menu, as the innermost handler wins in a native app, and a right-click there still opens the menu. On Android a context menu opens after a long press of no more than 500 ms, a `<pressable>`'s own long-press delay, where Android 11 and earlier and a longer Touch & hold delay setting waited longer, and TalkBack opens it with the element's long-press action. On Android a shortcut on a shifted character, such as `mod+?`, fires, and a shortcut does not fire while a `<modal>` is open.
