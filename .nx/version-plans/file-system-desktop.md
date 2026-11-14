---
__default__: patch
---

On macOS `FileSystem` in `@ng-native/expo` reads and writes through the desktop host's `NgNativeFileSystem`, and `paths` names `home`, `desktop`, `downloads`, `temp` and `appData`, where the service failed because the host's module has no `File` or `Directory`. The host is asynchronous there: `write()` answers a promise, `textSync()` throws, and a file's `exists` and `size` are the last answer until `settled()` resolves.
