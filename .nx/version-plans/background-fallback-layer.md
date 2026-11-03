---
__default__: patch
---

A stylesheet's `background: <gradient>, var(--x, center / cover)` now keeps the gradient when `--x` is unset, as Chrome does, where a fallback of several words with no colour made the shorthand invalid.

In development such a fallback no longer draws a warning that the custom property is undefined and the declaration dropped, which it said for `var(--x, none)` too.
