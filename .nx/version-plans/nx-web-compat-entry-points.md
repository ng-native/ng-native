---
__default__: patch
---

`nx typecheck` in a workspace whose libraries are package links resolves `@ng-native/web-compat`'s entry points, `@ng-native/web-compat/ng-icons` among them, from its `dist` as it does the other packages that publish them.
