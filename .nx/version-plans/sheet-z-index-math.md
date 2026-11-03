---
__default__: patch
---

A `z-index` of a math function in a stylesheet, such as `calc(3 / 2)` or `min(-2.5, 4)`, now compiles to the integer Chrome rounds it to, as the same value set in a style already did, where it was dropped with a warning.

A math function that comes to a length, such as `calc(1px)`, is still dropped with a warning, as Chrome drops it. One that comes to NaN, such as `sqrt(-1)`, compiles to 0, as Chrome reads it. A `round()` to the nearest, such as `round(-1.5, 1)`, is dropped with a warning, since the compiler would round a negative tie away from zero where Chrome rounds it up. A `round()` with a negative interval, such as `round(up, 3, -2)`, rounds as Chrome does, and the function and strategy names are read in any case. A z-index past the range of a 32-bit integer, such as `calc(infinity)` in a stylesheet or `calc(1e20)` in either, is clamped to that range, as Chrome clamps it. One with a string in it, such as `calc("2")`, is dropped with a warning, as Chrome drops it.
