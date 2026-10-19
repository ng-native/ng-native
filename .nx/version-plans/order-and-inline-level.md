---
__default__: patch
---

`order` is supported on the children of a flex container, where it was dropped with a warning.

The engine commits them in that order. `inline-flex` is kept as a box that sits in a line, as `inline-block` is: in a `display: block` container it is as wide as its content rather than stretched, a block holding only such boxes lays them out in lines, and a run of them among blocks shares a line. In a flex container it is laid out as before.
