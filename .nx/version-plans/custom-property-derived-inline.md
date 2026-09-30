---
__default__: patch
---

A custom property set on an element to a value with a `var()` inside it, such as `[style.--size]="'calc(var(--gap) * 2)'"` or `style="--fill: hsl(var(--hue) 100% 50%)"`, now resolves where it is set, as the same value in a stylesheet does, and follows a theme or an ancestor that changes the tokens it reads.

This covers the shapes a stylesheet's custom property takes: `calc()`, `min()` and `max()` of numbers, `px` and `rem` lengths, angles, times and `var()`; `hsl()` with a `var()` for a channel; and `rgb()` or `hsl()` of one channels token, such as `rgba(var(--rgb), 0.5)`, with an alpha written or from a token. A value its tokens make nothing of, such as `calc(var(--word) * 2)`, or one in a cycle, is invalid, so a rule that reads it takes its own fallback.

A value with a `var()` inside it in any other shape, such as `rgb(var(--r) 0 0)` or `calc(var(--a, var(--b)) * 2)`, which a stylesheet refuses at build time, is now unset on an element as well. Before, a colour function with a `var()` in it was sent to native as it was written.
