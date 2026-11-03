---
__default__: patch
---

`@ng-native/router` lays a stack's hidden navigation bar out with a large title before the first `<native-header largeTitle>` page is pushed onto it, so on iOS that push no longer starts from the compact bar, with the inline title fading out and the large title dropping into place.

The bar is hidden while the stack's root page has no header, and react-native-screens turns large titles on only once the push has started. A header with a large title now asks a new native module in `@ng-native/expo` to lay the hidden bar out once beforehand, so the app needs that package and a new development build. In Expo Go, which cannot load it, the first such push still starts from the compact bar.
