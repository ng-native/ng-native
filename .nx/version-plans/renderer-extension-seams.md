---
__default__: patch
---

`extendRenderer()` in `@ng-native/platform` and `extendNodes()` in `@ng-native/fabric` let a package outside core take over listeners, attributes, properties and bound styles, and give engine nodes members of its own.

They also tell the package as elements are created, inserted and removed. `registerViewName()` now
returns a function that restores what the element name was before, and `registeredViewName()` is
exported. They are what an opt-in web-compatibility package is built on.
