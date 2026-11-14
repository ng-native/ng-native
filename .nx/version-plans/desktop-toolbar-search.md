---
__default__: patch
---

On macOS the desktop host draws a header's `<native-search-bar>` from `@ng-native/router` as the window toolbar's search item (`NSSearchToolbarItem`), at its trailing end. It reports typing, Return, Escape, focus and blur as iOS does, and takes the search bar's `focus`, `blur`, `setText`, `clearText` and `cancelSearch` commands.
