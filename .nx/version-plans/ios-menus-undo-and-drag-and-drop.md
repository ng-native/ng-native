---
__default__: patch
---

On iOS, in a development build (not in Expo Go), `@ng-native/components` draws the iPad menu bar from `<menu-bar>` through UIMenuBuilder, with its items' shortcuts, and every `[shortcut]` works from a hardware keyboard on iPhone and iPad. `UndoStack` is available on iOS, over one undo manager that every window shares, so shake to undo, mod+z and Edit > Undo on an iPad reach the app's actions while no text input has focus. `[contextMenu]` opens on a long press on iOS, and on a secondary click from an iPad pointer, as a UIContextMenuInteraction on the element's own view, found by its `nativeID` (an element without one is given one), and a `(longPress)` on the same element then does not also fire. On iPadOS, `(fileDrop)` takes files, text and links dragged onto a view, and `[dragItem]` lets a view be dragged out, through `DragAndDrop` in `@ng-native/device`.
