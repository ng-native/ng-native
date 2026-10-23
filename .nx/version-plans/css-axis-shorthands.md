---
'__default__': patch
---

A stylesheet's `padding-horizontal`, `padding-vertical`, `margin-horizontal` and `margin-vertical` compile as `padding-inline`, `padding-block`, `margin-inline` or `margin-block` with the same one value does, to both edges of the axis. An `em` value (`padding-horizontal: 1.5em`), which was sent to native unresolved and drew no padding, now resolves against the font size, and a `calc()` of lengths (`calc(1rem + 2px)`, `calc(10% + 4px)`), which was dropped, now compiles. A second value is dropped with a warning that points to `padding-inline`, and `inherit` with the warning any CSS-wide keyword gets. On the web host the browser reads the CSS itself and has none of these properties, so there they do nothing.
