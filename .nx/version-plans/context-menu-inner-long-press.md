---
__default__: patch
---

On Android and iOS, a `<pressable>` with its own `(longPress)` inside an element with a `[contextMenu]` keeps its long press, and its `(press)`: a long press there opens no menu, as the innermost handler wins in a native app, and the menu opens on a long press nothing inside it takes. On Android a right-click still opens the menu; on iPadOS a pointer's secondary click there opens none either. `Menus` in `@ng-native/device` has `setTakesLongPress(nativeID, takes)`, which the `NgNativeMenus` module takes beside `setContextMenu`.
