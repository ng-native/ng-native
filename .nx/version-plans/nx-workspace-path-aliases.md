---
__default__: patch
---

`nx g @ng-native/nx:app` now reaches a workspace's tsconfig path aliases in a package-manager workspace too, as it already did in an integrated one: the app's `tsconfig.json` extends `tsconfig.base.json` when it has a `paths` list, and its Vitest config resolves them, so `nx typecheck`, `nx test` and Metro find the workspace's libraries.
