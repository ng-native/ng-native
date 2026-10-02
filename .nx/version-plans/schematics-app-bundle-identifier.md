---
__default__: patch
---

`ng add @ng-native/schematics` and its `application` schematic now set the app's iOS bundle identifier and Android package in `app.json`, where `expo prebuild` used `com.anonymous.<name>`. They default to `com.<scope>.<name>`, as `nx g @ng-native/nx:app` does, and a new `--bundleIdentifier` option sets one, refused with an error if iOS or Android would refuse it. Existing apps are unchanged.

`ng update` with no package names now suggests `ng update @ng-native/schematics` for the Angular Native packages, rather than `ng update @ng-native/components`, which moved that package alone.
