---
'__default__': patch
---

`@ng-native/router` gains a screen's bottom toolbar on iOS: `<native-toolbar>` with `<native-toolbar-item>`s, each a button with an SF Symbol or a title and a `(press)` output, a fixed or fluid spacer, or the place the integrated search field goes, so buttons can sit either side of it.

react-native-screens has no toolbar, so the two elements commit as Expo Router's native toolbar views: an app that uses them installs `expo-router` for its native half, with `npx expo install expo-router`. None of its JavaScript is imported, and Expo Go has it built in. The toolbar needs iOS 18, and the search field's place in it iOS 26. Android draws nothing for either element.
