---
'__default__': patch
---

A `transform` with a token in it takes `translate3d()` and `scale3d()`, across and down since a view has no depth, and an angle token can fall back to a bare `0`: `rotate(var(--r, 0))` is no longer dropped where `--r` is not set.
