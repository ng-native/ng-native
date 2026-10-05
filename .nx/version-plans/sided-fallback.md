---
__default__: patch
---

`margin: var(--gap, 0 24px)` and `padding: var(--gap, 1px 2px 3px 4px)` use the fallback, each side taking its own part of it, where the token is not set. A fallback with more than one value was discarded with no warning, leaving the box with no margin or padding at all.
