---
__default__: patch
---

A value set on an element that a browser drops, such as `[style.width]` going from `40px` to `-4px` or `[style.padding]` to `1px -1px`, now leaves the value set before it, as Chrome's `setProperty` does, where it took that value away so the stylesheet's showed.

This holds for a single property, a shorthand of sides such as `padding`, and a shorthand of mixed parts such as `border` or `background`, and for a previous value that was a `var()`. The dropped value is still reported with a warning in development. Removing the binding takes the earlier value away, as before.
