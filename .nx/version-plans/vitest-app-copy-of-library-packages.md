---
__default__: patch
---

`ngNative()` in `@ng-native/testing/vitest` now resolves a package a workspace library imports to the app's copy when the library's copy is the same version in another directory, so a test loads one `@ng-native/components`, as the Metro bundle does.

A library installed after the app can get its own pnpm peer context, and with it a second
directory for `@ng-native/components` at the app's version. Vite resolved the library's imports
to that copy, so a test that rendered a library component had two component registries, and
Angular reported NG0912 collisions for every component in it. The rule is the one
`withAngularNative` applies in Metro: a copy at a version of the library's own still resolves
where it is, as does a package the app does not reach. An existing app gets it by updating
`@ng-native/testing`; its Vitest config is unchanged.
