---
__default__: patch
---

A `display: var()` whose fallback native has no layout for, such as `var(--d, grid)`, now warns at build time and keeps reading the token, and a fallback of two keywords such as `var(--d, inline flex)` is kept where it was dropped.
