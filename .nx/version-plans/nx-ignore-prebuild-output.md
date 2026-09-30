---
__default__: patch
---

`nx g @ng-native/nx:app` now writes a `.gitignore` in the app that ignores the `ios/` and `android/` projects `expo prebuild` generates, as the starter template does.
