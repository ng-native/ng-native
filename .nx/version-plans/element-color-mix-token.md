---
__default__: patch
---

A custom property set on an element to a `color-mix()`, such as `[style.--tint]="'color-mix(in srgb, var(--brand) 50%, white)'"`, now resolves as the same value in a stylesheet does, where before it was unset.

Each side can be a token with `var()` fallbacks, another `color-mix()`, an `rgb()` or `hsl()` of tokens, or a colour written out, with a percentage before or after it, in any space and hue method a stylesheet takes. The mix follows a theme or an ancestor that changes the tokens it reads. A `color-mix()` of colours written out, with no `var()` in it, is mixed too.
