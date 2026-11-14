---
__default__: patch
---

`DocumentPicker` from `@ng-native/expo/document-picker` is the file dialogs service. `save({ suggestedName, contents | fromFile, types })` writes a file where the user chooses and answers its uri, or `null` when they dismiss the dialog: on iOS and Android the user picks a folder and the file is made in it with `suggestedName`. `pickDirectory()` opens the system folder picker and answers the folder, or `null`, as `FileSystem.pickDirectory()` does, which is deprecated in its favour. Both use `expo-file-system`'s folder picker, and answer `null` where there is none.
