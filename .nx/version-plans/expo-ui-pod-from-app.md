---
__default__: patch
---

`pod install` no longer fails with "Unable to find a specification for `ExpoUI`" for an app without `@expo/ui` in a pnpm workspace where another package has it: `@ng-native/expo` now looks for `@expo/ui` from the app, and not through the `NODE_PATH` that `expo run:ios` sets.
