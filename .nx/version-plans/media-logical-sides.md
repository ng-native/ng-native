---
'__default__': patch
---

An equal `padding-inline-start` and `padding-inline-end` compile to `paddingStart` and `paddingEnd` in a stylesheet with an `@media` rule in it, as they do in one without, and so do `margin-inline-*`, `inset-inline-*` and `border-inline-*`. They were compiled to left and right. A sheet whose only blocks inside blocks are top-level at-rules such as `@media` is no longer printed again by lightningcss before it is compiled, so it compiles as it would without them.
