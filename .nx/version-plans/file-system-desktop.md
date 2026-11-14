---
__default__: patch
---

On macOS `FileSystem` in `@ng-native/expo` reads and writes through the desktop host's `NgNativeFileSystem`, and `paths` names `home`, `desktop`, `downloads`, `temp` and `appData`, where the service failed because the host's module has no `File` or `Directory`. A file there is synchronous as it is on iOS and Android, through the host's synchronous file calls: `exists` and `size` say what is there when read, `create()`, `write()` and `delete()` are done when they return, and `textSync()` reads at once.
