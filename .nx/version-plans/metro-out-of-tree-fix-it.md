---
__default__: patch
---

The error `@ng-native/metro` throws when an app asks for macOS without `experiments.outOfTreePlatforms` now shows the line to add to app.json, `"expo": { "experiments": { "outOfTreePlatforms": true } }`, and says to return the same setting from `app.config.js` or `app.config.ts`.
