---
__default__: patch
---

`@ng-native/web-compat` now gives an SVG shape with no attributes of its own, such as `<circle class="spinner" />` sized by a stylesheet, the geometry a shape has by default. Before, Android's native shape views crashed drawing one.
