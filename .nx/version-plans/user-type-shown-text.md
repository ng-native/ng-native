---
__default__: patch
---

`userEvent.type` from `@ng-native/testing` types each character into the text the field shows. After a keystroke the app refused or rewrote and put its own text back, the next character is added to that text, as on a device, where before it was added to the refused text: typing `a3` into a field that takes only digits and holds `12` now ends with `123`, not `12`.
