---
__default__: patch
---

A boolean view prop written as an attribute, such as `focusable="false"` on a component's own element, is committed as a boolean, where Android stopped with `java.lang.String cannot be cast to java.lang.Boolean`.

It applies to the props every native view reads as a boolean (`focusable`, `accessible`, `collapsable` and the rest of React Native's view and accessibility booleans) on an element no component takes the prop as an input for. `"false"` is false and anything else, the bare attribute included, is true. A stylesheet still reads the attribute as its text, so `[focusable="false"]` matches as it does in a browser.
