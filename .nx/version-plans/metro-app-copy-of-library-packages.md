---
__default__: patch
---

`withAngularNative` now resolves a package a workspace library imports to the app's copy when the library's copy is the same version in another directory, so the bundle holds one `@ng-native/components`, one React Native and one of each native module.

pnpm installs a package once per set of peers it resolves. A library that lists
`@ng-native/components` but not everything the app lists, such as `@babel/core`, gets its own
peer context, and a second directory for every package in it at the app's versions. Metro bundled
those from the library's files: a second component registry and a second React Native. A copy at a
version of the library's own still resolves where it is, as does a package the app does not reach,
and Metro warns when that puts two versions of an `@ng-native/*` package in the bundle, as it
already did for `@angular/core`.
