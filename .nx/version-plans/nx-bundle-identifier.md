---
__default__: patch
---

`nx g @ng-native/nx:app` now sets `ios.bundleIdentifier` and `android.package` in the app's `app.json`, from a new `--bundleIdentifier` option or, by default, `com.<workspace scope>.<name>`, so `expo prebuild` no longer falls back to `com.anonymous.<name>`.
