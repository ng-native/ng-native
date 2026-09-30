---
__default__: patch
---

An `hsl()` made of tokens now reads a token holding a bare saturation or lightness, such as `--s: 100` in `hsl(var(--h) var(--s) var(--l))`, as a percentage, as a browser does, in a stylesheet and set on an element.

Before, a token holding `100` was read as 100 rather than 100%, unlike the same `100` written in the `hsl()` itself, so the colour came out wrong. The legacy comma syntax takes a percentage alone, so `hsl(var(--h), var(--s), var(--l))` with bare-number tokens is invalid, and a rule that reads it takes its own fallback. A `calc()` of a percentage token, such as `calc(var(--half) * 2)`, is a percentage too, and reads as one wherever it is used.
