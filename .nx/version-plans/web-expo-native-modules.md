---
__default__: patch
---

A browser app on `@ng-native/web` that imports an `@ng-native/expo` service now builds with `vite build`, and starts under `vite` in a workspace that has Expo installed for its native app, with the service inert as the documentation says.

`ngNativeWeb()` now resolves a `require` of an Expo module (`expo-*`, `@expo/*`, `@react-native-async-storage/*` and `react-native-watch-connectivity`) to a module that throws when it is loaded, so the `catch` around it in the packages answers as it does where the module is missing. Before, `vite build` failed to resolve `expo-modules-core` in an app without Expo, and with Expo installed both the build and the dev server's pre-bundle failed on Expo's own imports from `react-native`. An `import` of such a module in browser code still resolves as before.
