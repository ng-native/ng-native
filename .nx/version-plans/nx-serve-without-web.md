---
__default__: patch
---

An app from `nx g @ng-native/nx:app` now has a `serve` target that runs `expo start`, in place of the `expo start --web` `@nx/expo` infers for every Expo app, since the app has no web platform.
