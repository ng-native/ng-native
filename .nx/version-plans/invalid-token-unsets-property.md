---
__default__: patch
---

A property that reads a custom property which is set but invalid where it is used is now unset, as in a browser, rather than taking the `var()`'s fallback.

This covers a token of the wrong kind (`--x: 10px` read by `color: var(--x, red)`), and a token made of others that makes nothing valid (`hsl(var(--h) 50% 50%)` with a percentage hue, a `calc()` mixing a percentage and a number, or an alias or `color-mix()` of such a token), in a stylesheet and set on an element. The property inherits its parent's value when it inherits, and takes its initial value otherwise, and a `var()` with alternatives, `var(--a, var(--b))`, no longer moves on to `--b` when `--a` is set. A token whose `var()` has nothing to substitute, because what it names is not set and it has no fallback, is still unset itself, so what reads it takes its fallback. A custom property set to `initial` is unset, and one set to `inherit` or `unset` takes its parent's value.
