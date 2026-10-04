---
__default__: patch
---

Tailwind's `ltr:` and `rtl:` variants apply. `:dir(ltr)` and `:dir(rtl)` are answered from the direction the app is laid out in, and an alternative the engine cannot match inside `:is()` or `:where()` is left out with a warning while the rest of the list still matches, as CSS reads those lists. Each used to drop the whole rule: `ltr:` never applied, and `open:` lost its `[open]` form to the `:popover-open` beside it.
