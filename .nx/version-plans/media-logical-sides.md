---
'__default__': patch
---

An equal `padding-inline-start` and `padding-inline-end` compile to `paddingStart` and `paddingEnd` in a stylesheet with an `@media` rule in it, as they do in one without, and so do `margin-inline-*`, `inset-inline-*` and `border-inline-*`. They were compiled to left and right. A sheet whose only blocks inside blocks are top-level at-rules such as `@media` is no longer printed again by lightningcss before it is compiled, so it compiles as it would without them.

An `overflow-x` and an `overflow-y` set to the same value in one rule, which compiled to `overflow` beside an `@media` rule, are now refused there with the warning to write `overflow`, as they already were in a sheet without one.
