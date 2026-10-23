---
'__default__': patch
---

`Accessibility` in `@ng-native/device` keeps the startup settings that did read when one of the screen reader, reduced motion or bold text reads fails, instead of dropping all four, and `@ng-native/testing` takes a text field to be a view named `TextInput` or `AndroidTextInput` as `@ng-native/fabric` does, through the new `isTextInputView(viewName)` export, rather than any view with `TextInput` in its name.

The setting whose read failed stays off, and the other three and the font scale are taken as the platform answered.
