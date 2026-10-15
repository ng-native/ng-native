---
'__default__': patch
---

A colour bound as a style and made of tokens, `color-mix(in srgb, var(--brand), white 20%)` or a relative colour such as `color(from var(--brand) srgb r g b)`, is worked out from the tokens where it is used, where it reached native as text and painted nothing.

The channels of a relative colour set on an element can use `min()`, `max()` and `clamp()`, and a relative colour in `color()`'s `srgb` is worked out there too.
