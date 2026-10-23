---
'__default__': patch
---

A `<native-tab>` in `@ng-native/router` with a `template` or `svg` icon no longer closes the app on iOS with react-native-screens 4.29 or later (Expo SDK 58): it commits the icon as an `image` with a `template` rendering mode, the form those releases read, and keeps `iconType: 'template'` for earlier ones.

react-native-screens 4.29 dropped the `template` icon type, and native aborts on an icon type it does not know, as the tab bar is created. The router reads the version from `react-native-screens/package.json`, so the app has to have react-native-screens installed, which it already needs for native tabs. Android is unchanged.
