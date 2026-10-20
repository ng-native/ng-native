---
__default__: patch
---

With `@ng-native/web-compat`, an `<svg>` and its shapes are matched by attribute selectors on the attributes they are given, as `svg[width="16"]` and `path[fill="none"]` are in a browser, and a style a script sets on a shape is no attribute of it, to `getAttribute()`, a selector or a copy.
