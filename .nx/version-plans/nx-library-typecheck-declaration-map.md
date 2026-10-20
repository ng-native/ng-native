---
__default__: patch
---

`nx typecheck` passes on a library `@ng-native/nx:library` generates in Nx's TypeScript preset, whose `tsconfig.base.json` turns on `declarationMap`, where it failed with TS5069.

The generated `tsconfig.typecheck.json` now sets `"declarationMap": false` beside `"composite": false`. The `library-typecheck-declaration-map` migration, which `nx migrate` runs, adds the same line to the `tsconfig.typecheck.json` of a library generated before, or notes a config with comments, which it leaves as it is. See [Updating an app](https://ng-native.com/guide/updating).
