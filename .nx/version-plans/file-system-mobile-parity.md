---
__default__: patch
---

`FileSystem.readdir()`, `stat()` and `watch()` in `@ng-native/expo` answer on iOS and Android in the same forms as on macOS: `readdir()` sorts the entries by name, gives a folder's `uri` without a trailing slash and rejects a folder that is not there (on Android it resolved to an empty list), `stat()` gives a folder's `size` as 0 rather than the total of what is in it, and `watch()` reports a folder's `uri` without a trailing slash.

On Android, `stat()` and `watch()` also reach a path whose uri holds a character a uri cannot, such as an unescaped space, where they threw before.
