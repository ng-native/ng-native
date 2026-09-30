---
__default__: patch
---

An app from `nx g @ng-native/nx:app` now lists the native modules its workspace libraries import in its own `package.json`, with their config plugins in `app.json`, so a development or release build links them as Expo Go does.

`@ng-native/nx:sync-native-modules` is a sync generator, registered on the app's `start`, `export` and `prebuild` targets. It reads what each app's libraries import from Nx's project graph, and adds any native module the app does not list, including one a package they import peers on (`react-native-svg` for `@ng-native/icons`). `nx sync:check` reports an app it would change. An app generated earlier can register it with `"syncGenerators": ["@ng-native/nx:sync-native-modules"]` on those targets.
