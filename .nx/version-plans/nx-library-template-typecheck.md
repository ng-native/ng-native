---
__default__: patch
---

`nx typecheck` on a library from `nx g @ng-native/nx:library` in the TypeScript preset checks its templates: the generator writes a `tsconfig.typecheck.json`, a `typecheck` target that runs `ngc` on it, and `@angular/compiler-cli` in the library's dev dependencies, where the inferred `tsc` target read no template and a misspelled input passed.

A library already generated can add the three by hand: the config extends `./tsconfig.lib.json` with `noEmit: true`, `composite: false` and `emitDeclarationOnly: false`, and the Angular options a generated app's `tsconfig.json` has.
