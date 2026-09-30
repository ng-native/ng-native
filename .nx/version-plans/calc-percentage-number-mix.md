---
__default__: patch
---

Arithmetic of tokens that mixes a percentage and a number, such as `calc(var(--n) + 10%)` or `max(var(--p), 1)`, is now invalid, as in a browser, in a stylesheet and set on an element.

Before, it came out as a bare number, and anything that read it as one used it: an opacity, or an `hsl()` saturation. A token of it is now invalid, so a property that reads it is unset, and a declaration of it is left out. A percentage multiplied or divided by a number is still a percentage, and one multiplied by another percentage, or a number divided by one, is invalid as well.
