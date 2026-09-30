---
__default__: patch
---

`nx add @ng-native/nx` now adds Babel 7's `@babel/core` at the workspace root, so the plugins in Expo's Babel preset no longer report an unmet `@babel/core` peer before an app is generated.

In an Angular workspace `@angular-devkit/build-angular` hoists Babel 8's `@babel/core` to the root, which answered that peer. The app generator already added Babel 7's; `nx add` alone now does too, at the same range.
