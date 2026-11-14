---
__default__: patch
---

`@ng-native/template-desktop` starts a macOS-only app: `npx create-expo-app my-app --template @ng-native/template-desktop`. It lists `macos` alone in `expo.platforms`, with `experiments.outOfTreePlatforms: true` and the `@ng-native/desktop` config plugin, has the scripts `start`, `macos`, `package`, `test` and `typecheck`, and starts on a sidebar and split view with a menu bar, sized for the Mac. `@ng-native/desktop` is published with the other packages.
