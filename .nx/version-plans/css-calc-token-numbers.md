---
__default__: patch
---

Arithmetic on a token is now read for a property that takes a number, `flex-grow`, `opacity`, `order` or `z-index`, and for a `line-height` that multiplies the font size, as Chrome reads it.

`opacity: calc(var(--o) / 2)` and `flex-grow: calc(var(--g) * 1.5)` were refused before, and `line-height: calc(var(--l) * 1.5)` with a number token was unset. A line height from a length token is a length, as before (`leading-6`). A token of the wrong kind unsets the property, to `flex-grow`'s 0 for that one, as in Chrome. Tailwind's `-order-(--x)` and `-z-(--x)` now compile.
