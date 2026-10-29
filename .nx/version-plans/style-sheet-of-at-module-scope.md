---
__default__: patch
---

In `@ng-native/metro`, a component's compiled sheet is on its class as soon as the class is defined, so `styleSheetOf(Component)` called at the top level of the module that declares it returns the sheet. Before, the sheet was attached after the rest of the module had run, and such a call returned `null`.
