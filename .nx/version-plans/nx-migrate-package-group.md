---
__default__: patch
---

`nx migrate @ng-native/nx@latest` now moves every `@ng-native/*` package in the root `package.json` to the new version, not just `@ng-native/nx`.

`@ng-native/nx` declares the other published packages as its `nx-migrations` package group. Nx adds none that the workspace does not already list, and like any `nx migrate`, it updates only the root `package.json`, so the `@ng-native/*` versions in an app's own `package.json` still move by hand.
