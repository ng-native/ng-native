---
__default__: patch
---

`document.elementFromPoint(x, y)` and `document.elementsFromPoint(x, y)` answer the element drawn at a point of the window when `provideWebCompat()` is provided, passing over elements with `pointer-events: none` or `display: none`, so a library that asks what a finger moved onto gets an answer.
