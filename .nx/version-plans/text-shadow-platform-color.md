---
'__default__': patch
---

A stylesheet's `text-shadow` takes `platform-color()` or a system colour such as `LinkText` as its colour, written out or as a `var()` fallback, and commits it as `textShadowColor` the way `color` commits it, where each was dropped with a warning.
