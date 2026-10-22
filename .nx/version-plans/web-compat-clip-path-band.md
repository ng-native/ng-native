---
__default__: patch
---

In an app with `provideWebCompat()`, an `<img>` that a library's stylesheet or a script clips to a band of itself with `clip-path: polygon(a 0, b 0, b 100%, a 100%)` is drawn through that band, and the compiler keeps such a band in a library's sheet and sends it to no native view.
