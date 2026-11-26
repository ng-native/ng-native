---
__default__: patch
---

A `<modal [anchor]>` bound to a template reference now type-checks under `strictTemplates`, `@ng-native/expo` exports `./date-time-picker` and `./segmented-control`, and a shortcut with a misspelt key name now throws.

`ModalAnchor` now takes an `HTMLElement`, which is what a reference to an element no component claims types as, and a `ViewBase`, which is what a reference to a component such as `<pressable #filter>` types as. Before, both failed with TS2322 although the modal read either at run time. `DateTimePicker` and `SegmentedControl` can be imported from their own subpaths, as `SearchField` is, and each has a docs page.

A shortcut key written as a word must be spelt as `KeyboardEvent.key` spells it: `ArrowUp`, `Enter`, `Escape`, `Backspace`, `Delete`, `Tab`, `Home`, `End`, `PageUp`, `PageDown`, `Insert`, `Pause`, `ScrollLock`, `ContextMenu` or `F1` to `F20`. Before, `shortcut="mod+enter"` or `"up"` was read and never fired. Now `parseShortcut()` throws, with the name it is probably a misspelling of, as it already did for an unknown modifier. `Space` is read as the space key on every OS; before, only iOS's menu keys knew it.
