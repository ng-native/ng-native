---
__default__: patch
---

`Dialogs.choose` from `@ng-native/device` logs its three-button error only on Android. On macOS, where `choose` is an alert with a button for every choice, a longer list is not an error.
