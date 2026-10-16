---
__default__: patch
---

A `ui-host` with `matchContents` in a `native-header-item` of type `title` or `center` now sizes to its content on iOS, instead of measuring 0 by 0 and hiding the header's title.

react-native-screens makes a title item the bar's title view at its Yoga size, and UIKit lays out no title view of 0 by 0, while a host sized to its SwiftUI content has no size until it is laid out. On iOS a title item now has a least size of one point each way, under any size the app gives it, so its content is laid out and measured.
