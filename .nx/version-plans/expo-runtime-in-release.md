---
__default__: patch
---

A new app's `src/main.ts` now imports `expo`, so a release build runs Expo's runtime as a debug build does, with Expo's `fetch` (whose response streams a `body`), `URL`, `TextDecoderStream` and `structuredClone`, rather than React Native's.

Metro runs Expo's runtime before the app only when something in the bundle imports `expo`. In debug, `mount()`'s reload hook does; in release nothing did, so an app could work in development and fail only in a release build. An existing app gets the same by adding `import 'expo';` at the top of its `src/main.ts`. The template, the `@ng-native/nx` and `@ng-native/schematics` generators and the manual setup guide all write it.
