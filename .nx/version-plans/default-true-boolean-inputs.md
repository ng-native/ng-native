---
__default__: patch
---

A boolean input whose default is `true`, bound to `null` or `undefined`, now takes that default, as one left unbound does. Before, it read `false`: `[enabled]` on `<keyboard-avoiding-view>` stopped avoiding the keyboard, `[enabled]` on `<ui-segmented-button>` and `<ui-dropdown-menu-item>` disabled them, `[showDragIndicator]` on `<ui-bottom-sheet>` hid the grabber, `[reportInsets]` on `<safe-area-provider>` stopped reporting insets, and `[cancelable]` on `<pressable>` refused to let another gesture take the press. `[visible]` on `<modal>` is unchanged.
