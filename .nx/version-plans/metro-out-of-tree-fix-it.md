---
__default__: patch
---

The error `@ng-native/metro` throws when an app asks for macOS without `experiments.outOfTreePlatforms` now shows what to add to app.json, `"expo": { "experiments": { "outOfTreePlatforms": true } }`, merged into the `expo` object already there rather than replacing it, and says to return `experiments: { outOfTreePlatforms: true }` from the config in `app.config.js` or `app.config.ts`. It also throws for an app.json that lists `macos` in `expo.platforms` without the flag, which Expo's config reading drops from the platforms before the check saw it.
