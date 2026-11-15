---
__default__: patch
---

On macOS `database()` in `@ng-native/expo` opens its database through the desktop host's `NgNativeSqlite`, where it failed because a host module cannot return a database object. `prepareAsync` and `serializeAsync` throw there, and a row's keys are not in the order of the `SELECT`.
