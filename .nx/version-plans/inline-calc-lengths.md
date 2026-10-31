---
__default__: patch
---

A `calc()` of lengths in `px` or `rem` and numbers, set in a `style` attribute or bound with `[style]` or `[style.x]`, is committed as the points it comes to, as the same value in a stylesheet is: `flex: 1 1 calc(10px + 10px)` and `width: calc(2 * 1rem)` were committed as their text, which native drops. A `calc()` with a percentage, an `em` or a viewport unit is left as before.
