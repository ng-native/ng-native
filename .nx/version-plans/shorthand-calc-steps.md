---
'__default__': patch
---

A side of a `padding`, `margin`, `inset` or `gap` shorthand that is a `calc()` of more than one step around a `var()` is worked out.

`padding: calc((var(--height, 72px) - 24px) / 2) 24px` was refused with a warning and the whole declaration dropped, where the same `calc()` in `padding-top` was worked out. A shorthand side now takes the sum the longhand takes, and follows the token being set and unset.
