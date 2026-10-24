---
'__default__': patch
---

An app or library `@ng-native/nx` generates in a workspace with tsconfig path aliases resolves them in its tests with `vite-tsconfig-paths`, so on Nx 24 a test that imports one of the workspace's libraries no longer fails with `Cannot find package`.

`nxViteTsPaths` from `@nx/vite`, which the generators wrote before, is a stub that resolves nothing from Nx 24. The `vitest-tsconfig-paths` migration rewrites each Vitest config the generators wrote that way, and adds `vite-tsconfig-paths` to the root `package.json` when it lists none.
