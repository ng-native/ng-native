---
'__default__': patch
---

A `:has()` whose argument is a list with an ancestor test in it, such as `.card:has(.x:is(.p *, .y))` or Tailwind's `has-*` with a custom variant written as `:where([data-theme=midnight], [data-theme=midnight] *)`, matches either alternative, as a browser does, instead of needing both. A `:has()` inside another `:has()` is dropped with a warning, as a browser drops it as invalid.
