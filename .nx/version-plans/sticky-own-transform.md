---
__default__: patch
---

A `position: sticky` box with a `transform` of its own is drawn with both on iOS and Android, as in a browser: native applies the box's own transform after the move that keeps it stuck, where it showed only the move. A `transform` transition native plays on such a box goes on moving with the scroll, and a box that stops sticking is drawn with its own transform.
