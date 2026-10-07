---
'__default__': patch
---

`:is(<scope> <compound> > *)` and `:is(<scope> <compound> *)` are read: a parent or ancestor test of a compound that is itself under another.

Tailwind's `*:` and `group-*` variants written inside a scope, `.theme { .card { @apply *:data-[slot=title]:font-medium } }`, compile to that shape, and the whole rule was dropped with a warning. A longer selector inside `:is()` is still refused.
