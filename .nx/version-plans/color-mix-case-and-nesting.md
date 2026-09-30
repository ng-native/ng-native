---
__default__: patch
---

A `color-mix()` with a token in it can be written in any case, such as `COLOR-MIX(IN SRGB, var(--brand) 50%, white)`, where before a stylesheet stopped the build on it, and a `color-mix()` of tokens nested in another now comes out as Chrome's colour.

The inner mix was rounded to whole channels before the outer one mixed it, which put a channel one step off: `color-mix(in srgb, color-mix(in srgb, var(--red), blue), white)` gave 192 where Chrome gives 191.
