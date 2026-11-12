---
__default__: patch
---

`FileSystem.pickDirectory()` in `@ng-native/expo/file-system` opens the system folder picker on iOS and Android and answers the folder the user chose, or `null` when they dismiss it. A file is made in that folder with its `createFile(name, mimeType)` and written with `write()`.
