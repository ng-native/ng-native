---
__default__: patch
---

A `var()` fallback written below zero, on a property that takes nothing below zero, now unsets the property when it is used, as Chrome does, in `em` as in points.

`width: var(--x, -1em)` was clamped to 0, as `calc(1em - 2em)` is; a math function's result is still clamped. A `padding` or `border-radius` fallback with one side below zero, `var(--x, 4px -1px)`, now unsets every side, where it kept the others. A `margin` keeps a side below zero, as before.
