---
__default__: patch
---

`nx typecheck` in a workspace whose libraries are the package manager's links resolves `@ng-native/testing/device` and its other entry points to the app's own copy, as it does the other packages' entry points.
