---
__default__: patch
---

`FileSystem` from `@ng-native/expo/file-system` lists a folder with `readdir()`, describes a path with `stat()` (its size, whether it is a folder, and when it was modified and created) and reports changes to a path with `watch()`, through `expo-file-system`'s `Directory`, `File` and `Paths`. `paths` names the app's `cache` and `document` folders as uris, and has `home`, `desktop`, `downloads`, `temp` and `appData`, which are `null` on iOS and Android. Where the service is absent, `readdir()` answers no entries, `stat()` answers `null` and `watch()` reports nothing.
