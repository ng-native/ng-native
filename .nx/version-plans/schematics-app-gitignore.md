---
__default__: patch
---

`ng add @ng-native/schematics` and its `application` schematic now write a `.gitignore` in the app's directory, so the `ios/` and `android/` projects `expo prebuild` writes and the `.angular-native/` Tailwind generates are no longer offered for commit.

The lines are the template's own. Existing apps are unchanged.
