---
__default__: patch
---

`display: var(--d)` now reads a token in the two-keyword form, such as `inline flex` or `block flow`, as `flex`, and in development logs a warning naming the token and its value when it holds a display native has no layout for, such as `grid` or `table`.

Each pair of `block` or `inline` with `flow`, `flow-root` or `flex`, in either order, is `flex`, as Chrome computes it to a display native reads as `flex`, and so is `flow` on its own. Any other value still unsets `display`, so the element lays out as a flex column, and the warning comes once per token and value. A release build doesn't check.
