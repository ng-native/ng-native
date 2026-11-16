---
__default__: patch
---

`@ng-native/template-desktop` starts a macOS-only app: `npx create-expo-app my-app --template @ng-native/template-desktop`. It lists `macos` alone in `expo.platforms`, with `experiments.outOfTreePlatforms: true` and the `@ng-native/desktop` config plugin, has the scripts `start`, `macos`, `package`, `test` and `typecheck`, and starts on a sidebar and split view with a menu bar, sized for the Mac. Its tests run in two Vitest projects: `node-macos`, which `npm test` runs in Node, and `macos`, which `npx vitest --project macos` runs inside the app on a Mac, from `src/**/*.device.ts`, with Metro started with `EXPO_PUBLIC_DEVICE_TESTS=1`. `@ng-native/desktop` is published with the other packages.
