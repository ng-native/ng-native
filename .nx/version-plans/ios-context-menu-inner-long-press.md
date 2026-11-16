---
__default__: patch
---

On iOS, a `<pressable>` with its own `(longPress)` inside an element with a `[contextMenu]` keeps its long press, and its `(press)`: a long press there opens no menu, as the innermost handler wins in a native app, and on iPadOS a pointer's secondary click there opens none either. `Menus` in `@ng-native/device` has `setTakesLongPress(nativeID, takes)`, which the `NgNativeMenus` module takes beside `setContextMenu`.
