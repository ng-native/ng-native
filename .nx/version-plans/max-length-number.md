---
__default__: patch
---

`@ng-native/web-compat` now sends a field's `maxLength` to native as a number however it is written: `[attr.maxLength]`, as Taiga UI's number input binds it, wrote its text over the number, and Android's text field crashed the app on it.
