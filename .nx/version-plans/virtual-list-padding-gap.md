---
__default__: minor
---

`<virtual-list>` takes `contentPadding` and `rowGap`, which put space around its rows and between them, and which every offset it works out counts.

`contentPadding` is one number for every side, or `{ top, right, bottom, left }`, as `FlatList`'s `contentContainerStyle` padding: the leading side comes before the first row, the trailing side after the last, and the sides across the axis inset each row. `rowGap` is the space between one row and the next. Row positions, the content's extent, the spacer before rows that size themselves, sticky rows, `scrollToIndex`, viewability and `endReached` all account for both. Rows placed at a fixed height commit `left` and `right` insets (or `top` and `bottom` when horizontal), and rows that size themselves commit margins. With neither set, the committed props are as before. The new `VirtualListPadding` type is exported from `@ng-native/components`.
