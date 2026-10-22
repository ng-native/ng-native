---
'__default__': patch
---

`@ng-native/fabric` exports `isTextInput(node)`, which says whether a node commits as a text input (`TextInput` on iOS, `AndroidTextInput` on Android), and `@ng-native/components` and `@ng-native/web-compat` use it in place of their own copies of those view names.
