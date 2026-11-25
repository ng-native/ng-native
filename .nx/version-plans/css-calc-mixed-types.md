---
__default__: patch
---

A `calc()` that adds a number to a length is now invalid, as CSS finds it, where it used to commit as though the number were a length.

A token holding one, `--t: calc(1px + 2)` in a stylesheet or set on an element, is read as no length and no number, so a `width: var(--t)` is unset, as in Chrome. Written in a declaration around a token, `width: calc(var(--t) + 2)`, it is invalid whatever the token holds, and is refused with a build warning, as a value of the wrong type written out is. A number that multiplies a token, `calc(-0.5 * var(--x))`, and a length divided by a length, which is a number, are read as before.
