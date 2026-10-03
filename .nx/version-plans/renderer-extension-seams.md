---
__default__: patch
---

`extendRenderer()` in `@ng-native/platform` and `extendNodes()` in `@ng-native/fabric` let a package outside core take listeners over and give engine nodes members of its own, which is what an opt-in web-compatibility package is built on.
