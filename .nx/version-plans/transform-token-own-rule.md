---
'__default__': patch
---

A `transform` that is a token of its own rule is read where the token's value is transform functions with a `var()` or a `calc()` inside them.

`--move: translateY(calc(6px + var(--h) / 2)) scale(var(--s)); transform: var(--move)` was refused with a warning, because no one form of a token holds a transform with a sum and tokens inside it, and the element had no transform. The compiler now reads the token's value in place of the `var()` in the same rule, so the transform follows `--h` and `--s` as it would written out. A token another rule reads stays a token.
