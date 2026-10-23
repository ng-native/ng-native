---
'__default__': patch
---

A `var()` in a property the compiler does not translate, such as `caret-color: var(--x)` or `scroll-margin: var(--x)`, is dropped with the warning the same property written out gets ("not mapped yet" or "has no React Native equivalent"), where the warning called it a shorthand.
