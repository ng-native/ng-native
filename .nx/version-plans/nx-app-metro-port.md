---
__default__: patch
---

`nx g @ng-native/nx:app` now gives each app a Metro port of its own, so `nx run-many -t start` runs two apps side by side instead of the second failing with `EADDRINUSE`.

The first Expo app in a workspace keeps `expo start` on Expo's default port, 8081. A later app's `start` and `serve` targets run `expo start --port <n>`, with the lowest port that no other app's `start` or `serve` uses. An Expo app with no `start` command of its own counts as on 8081. Existing apps are unchanged.
