---
__default__: patch
---

Arithmetic on a token is now read for a property that takes a number, `flex-grow`, `opacity`, `order` or `z-index`, and for a `line-height`, where it used to be refused or unset.

`opacity: calc(var(--o) / 2)` and `flex-grow: calc(var(--g) * 1.5)` were refused before, and `line-height: calc(var(--l) * 1.5)` with a number token was unset; each now comes out as in Chrome. A line height from a length token is a length, as before (`leading-6`), and so is `calc(var(--n) * 1px)` from a number token. A token of the wrong kind unsets the property, to `flex-grow`'s 0 for that one, as in Chrome. Tailwind's `-order-(--x)` and `-z-(--x)` now compile. `order` and `z-index` take a whole number, and Chrome rounds a fractional result for them; a fractional token's result is not rounded here yet.
