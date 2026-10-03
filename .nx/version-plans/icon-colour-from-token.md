---
__default__: patch
---

An icon's own markup takes a colour from a custom property: a `fill` or a `stroke` whose value is a `var()`, as an attribute or in `style`, is painted from the token in scope and follows it, where a `style` one left the path unpainted and an attribute sent the text `var(--brand)` to native as the colour.

An unset token with no fallback is reported in development.
