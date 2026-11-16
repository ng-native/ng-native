---
__default__: patch
---

On macOS `FileSystem` in `@ng-native/expo` reads and writes through the desktop host's `NgNativeFileSystem`, and `paths` names `home`, `desktop`, `downloads`, `temp` and `appData`. `pickDirectory()` opens the desktop host's folder panel, and a picked folder's `createFile()` makes the file in it. A file there is synchronous as it is on iOS and Android, through the host's synchronous file calls: `exists` and `size` say what is there when read, `create()`, `write()` and `delete()` are done when they return (`create()` fails rather than empty a file that is there), and `textSync()` reads at once.
