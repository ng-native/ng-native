---
'__default__': patch
---

A stylesheet's `border` (and each side), `outline` and `text-decoration` take a `platform-color()` written in them, as `text-shadow` does, so `border: 1px solid platform-color(link)` commits the platform's colour for each side where it was dropped with a warning. A `box-shadow` still drops one.
