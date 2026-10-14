---
'__default__': minor
---

`<search-field>` from `@ng-native/expo/search-field` is the system search field outside a navigation bar, such as in a bottom sheet: UIKit's `UISearchBar` on iOS and AndroidX's `SearchView` on Android, with `<native-search-bar>`'s two-way `query`, `placeholder`, `(search)`, `(cancel)`, `(searchFocus)`, `(searchBlur)` and `focus()`, `blur()` and `clear()`. It is native code of `@ng-native/expo`, so a development build has to be rebuilt to pick it up, and Expo Go draws nothing for it. `@ng-native/expo` now depends on `androidx.appcompat` on Android, which React Native already brings.
