---
__default__: patch
---

On macOS, `DocumentPicker.save()` in `@ng-native/expo` writes through the desktop host's save panel, bytes included, and `pickDirectory()` opens its folder panel, answering a folder whose `createFile()` makes a file in it, as on iOS and Android.
