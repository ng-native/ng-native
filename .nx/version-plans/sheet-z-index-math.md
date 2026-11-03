---
__default__: patch
---

A `z-index` of a math function in a stylesheet, such as `calc(3 / 2)` or `min(-2.5, 4)`, now compiles to the integer Chrome rounds it to, as the same value set in a style already did, where it was dropped with a warning.

A math function that comes to a length, such as `calc(1px)`, is still dropped with a warning, as Chrome drops it.
