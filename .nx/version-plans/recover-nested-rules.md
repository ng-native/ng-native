---
'__default__': patch
---

A library's stylesheet with a rule that does not parse nested inside one that does, such as `@keyframes` in a style rule, keeps the rules nested beside it, where they were dropped with it.
