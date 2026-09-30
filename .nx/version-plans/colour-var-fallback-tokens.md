---
__default__: patch
---

A `var()` inside `color-mix()`, a gradient colour stop or a shadow colour can now fall back to a colour made of other tokens, such as `var(--missing, hsl(var(--h) 100% 50%))`, which is worked out from the tokens where it is used, as a browser does.

Before, such a fallback stopped the build with "expected a colour", and only a literal colour or another `var()` was taken. The fallback can be an `hsl()` of tokens, a colour of a channels token such as `rgba(var(--rgb), 0.5)`, or a `color-mix()` of tokens, at the end of any chain of `var()`s, and it follows a theme or an ancestor that changes the tokens it reads.
