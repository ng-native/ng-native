---
__default__: patch
---

`styleSheetOf()` and `loadFonts()` warn in development in a browser build too, where `ngDevMode` stands in for the `__DEV__` a browser bundler does not define.

The warning about a `styleSheetOf()` read from a static field of the component's own class, and the one about a `null` sheet given to `loadFonts()` or `FontRegistry.loadSheet()`, were said on a device only. `__DEV__` still decides wherever it is defined, so a release build on a device stays silent. The `globalStyles: null` warning of `mount()` from `@ng-native/platform` is still a device warning, since `@ng-native/web` has its own `mount()`.
