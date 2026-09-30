---
__default__: patch
---

A second or later app from `nx g @ng-native/nx:app` now gets `run-ios` and `run-android` targets that pass its own Metro port, so its build loads from its own Metro rather than the first app's on 8081.

The targets run `expo run:ios --port <n>` and `expo run:android --port <n>` with the port its `start` uses. The first app in a workspace keeps the targets `@nx/expo` infers. Existing apps are unchanged.
