---
__default__: patch
---

`@ng-native/nx` has two new generators: `nx g @ng-native/nx:library` for a library whose tests render on the fake Fabric, and `nx g @ng-native/nx:component` for a native component with its test.

`library` runs `@nx/angular:library` without its tests (`@nx/js:library` with no bundler in the TypeScript preset). It then writes the app's `vitest.config.mts`, a `test` target that runs Vitest once, a `tsconfig.spec.json`, and a component built from `<view>` and `<text>` with a `.test.ts`, and adds `@ng-native/components`, `@ng-native/testing` and Vitest. `component` writes the same files as `@ng-native/schematics`' component schematic, under `src/lib` in a library and `src/app` in an app.
