---
__default__: patch
---

`light-dark()` in a stylesheet built with the Tailwind preset is the two colour schemes it names. It was lowered to a pair of `var()`s the compiler drops, so a custom property written with it, as every colour of an Angular Material theme is, had no value, and a declaration written with it was dropped with a warning.
