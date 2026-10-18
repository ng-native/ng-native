---
__default__: patch
---

`extendRenderer()` in `@ng-native/platform` and `extendNodes()` in `@ng-native/fabric` let a package outside core take listeners, attributes, properties and bound styles over, be told as elements are created, inserted and removed, and give engine nodes members of its own. `registerViewName()` now returns a function that restores what the element name was before, and `registeredViewName()` is exported. They are what an opt-in web-compatibility package is built on.
