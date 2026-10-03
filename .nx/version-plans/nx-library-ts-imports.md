---
__default__: patch
---

A library from `nx g @ng-native/nx:library` in the TypeScript preset lets its source import with `.ts`, as its test and the documentation do, where `nx typecheck` failed with `TS5097`.

`tsconfig.lib.json` gets `allowImportingTsExtensions`, and `src/index.ts` exports `./lib/<name>.ts`. A workspace whose base config no longer sets `emitDeclarationOnly` keeps the `.js` form, since TypeScript takes the option only where no JavaScript is emitted. A library already generated is not changed: add the option to its `tsconfig.lib.json` by hand.
