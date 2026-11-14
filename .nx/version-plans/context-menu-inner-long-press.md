---
__default__: patch
---

On Android, a `<pressable>` with its own `(longPress)` inside an element with a `[contextMenu]` keeps its long press, and its `(press)`: a long press there opens no menu, as the innermost handler wins in a native app, and the menu opens on a long press nothing inside it takes. A right-click still opens the menu. `Menus` in `@ng-native/device` has `setTakesLongPress(nativeID, takes)`, which the `NgNativeMenus` module takes beside `setContextMenu`.
