---
__default__: patch
---

A `calc()` with a token in it that adds a number to a length is now invalid, as CSS finds it, in a token's own value and in a length, a number or a box shorthand that reads tokens; it used to commit as though the number were a length.

A token holding one, `--t: calc(1px + 2)` in a stylesheet or set on an element, is read as no length and no number, so a `width: var(--t)` is unset, as in Chrome. Written in a declaration around a token, `width: calc(var(--t) + 2)` or a side of `padding`, it is invalid whatever the token holds, and is refused with a build warning, as a value of the wrong type written out is. A number that multiplies a token, `calc(-0.5 * var(--x))`, a length added to a percentage, a group in brackets, and a length divided by a length are read as before. A transform's arguments are not checked this way yet.
