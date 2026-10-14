---
'__default__': minor
---

`<search-field>` from `@ng-native/expo/search-field` is the system search field outside a navigation bar, such as in a bottom sheet: UIKit's `UISearchBar` on iOS and AndroidX's `SearchView` on Android, with `<native-search-bar>`'s `placeholder`, `(search)`, `(cancel)`, `(searchFocus)`, `(searchBlur)` and `focus()`, `blur()` and `clear()`. Its text is a two-way `value`, and with `disabled` and `touch` it is a Signal Forms control: `[formField]` binds it as it binds a `<text-input>`. It is native code of `@ng-native/expo`, so a development build has to be rebuilt to pick it up, and Expo Go draws nothing for it. `@ng-native/expo` now depends on `androidx.appcompat` on Android, which React Native already brings.
