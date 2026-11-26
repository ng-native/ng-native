---
__default__: patch
---

A stylesheet's `background-size` below zero, on its own or after the slash in a `background` shorthand, is now dropped with a build warning, as a browser drops it. Before, it compiled to a negative size. A `calc()` that comes out below zero is 0, as a browser clamps it.
