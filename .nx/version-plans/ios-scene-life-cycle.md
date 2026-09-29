---
__default__: patch
---

`@ng-native/metro` is also an Expo config plugin, `"plugins": ["@ng-native/metro"]`, and the
template and both generators add it. It adopts the UIKit scene life cycle in the `AppDelegate.swift`
that `expo prebuild` writes, since an app built with the iOS 27 SDK that does not exits at launch
with "UIScene life cycle is required for apps built with this SDK". React Native now starts from a
scene delegate, which hands the links the app is opened with and receives, and its life cycle
events, on to `AppDelegate`, so Expo's modules and code added there see them as before. What
another plugin adds among the lines it replaces, as `@react-native-firebase/app` does, stays. For
an app made before this release, add `"plugins": ["@ng-native/metro"]` to `app.json` and run
`npx expo prebuild --clean`.
