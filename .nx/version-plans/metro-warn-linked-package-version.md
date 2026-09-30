---
__default__: patch
---

`withAngularNative` now warns when an app's `@ng-native/*` package linked from a workspace folder and a library's installed copy of it are different versions, as it already did for two installed copies.

The check found a package's copies by the `node_modules` in their paths, and a linked workspace
package's real path has none, so an app on a `workspace:` package and a library on a registry
version of it bundled both with no warning. Metro's `getPackageForModule` now names the package
a file outside `node_modules` belongs to, for imports of `@angular/core` and `@ng-native/*`.
