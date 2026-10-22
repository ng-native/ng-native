---
'__default__': patch
---

A stylesheet now takes React Native's axis shorthands, `padding-horizontal`, `padding-vertical`, `margin-horizontal` and `margin-vertical`, which were dropped with a "not mapped yet" warning though `[style.paddingHorizontal]` worked.

Each takes one value and compiles as `padding-inline`, `padding-block`, `margin-inline` or `margin-block` with that value does, to both edges of its axis, so the cascade settles it against `padding-left`, `padding-inline-start` and the other edges by order and specificity. A second value is dropped with a warning that points to `padding-inline`. On the web host the browser reads the CSS itself and has none of these properties, so there they do nothing.
