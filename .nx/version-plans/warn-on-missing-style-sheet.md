---
__default__: patch
---

In a development build, `styleSheetOf()` in `@ng-native/fabric` warns when it is called too early to see a class's own sheet, as from a static field of the component's own class, where it reads `null` or a styled base class's sheet. `mount()` in `@ng-native/platform` warns when given `globalStyles: null`, and `loadFonts()` in `@ng-native/expo` warns when given a `null` sheet. `styleSheetOf()` warns once per class, the other two once per app run; a release build never warns.
