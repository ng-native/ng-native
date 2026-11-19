---
__default__: patch
---

On macOS `text-decoration-line: line-through` (and `textDecorationLine: 'line-through'` or `'underline line-through'`) now draws a line through the text, which it never did, and an underline or a line through takes `text-decoration-color` and a `double`, `dotted` or `dashed` `text-decoration-style`.
