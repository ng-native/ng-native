---
__default__: patch
---

A `var()` whose fallback is made of other tokens, such as `width: var(--missing, calc(var(--gap) * 2))`, now uses that fallback, worked out from the tokens where it is substituted, in a stylesheet and set on an element.

Before, the fallback was dropped, so the declaration was unset. This covers a fallback that is `calc()`, `min()` or `max()` of tokens, an `hsl()` or other colour made of tokens, and a fallback that is another `var()` with such a fallback of its own, `var(--a, var(--b, calc(var(--gap) * 2)))`. Inside arithmetic, `calc(var(--missing, var(--gap)) * 2)` and `calc(var(--missing, calc(var(--gap) * 2)) + 1px)` now resolve too, where a stylesheet refused them at build time. A cycle through a fallback, `--x: var(--missing, calc(var(--x) * 2))`, is invalid, as in a browser, so a rule that reads it takes its own fallback.

Custom properties defined together are also settled as a browser settles them, whatever order they are in. A fallback such as the `1px` in `calc(var(--b, 1px) * 2)` is taken only when `--b` is unset or invalid, never because `--b` is made of other tokens and not yet worked out. A `var()` naming a token that turns out invalid takes its own fallback. And a token read inside its own fallback, `calc(var(--x, 3px) * 2)` as `--x`, is a cycle.
