---
__default__: patch
---

On macOS, `DocumentPicker.save()` in `@ng-native/expo` writes through the desktop host's save panel, bytes included, and `pickDirectory()` opens its folder panel, answering the folder's `uri`. A folder picked on macOS has no `createFile` yet: it throws and says to use `save()`.
