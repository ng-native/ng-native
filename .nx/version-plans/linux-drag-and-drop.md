---
__default__: patch
---

On the GTK desktop host on Linux, `(fileDrop)`, `(fileDragEnter)` and `(fileDragLeave)` take files, text and urls dragged onto a view, and a `[dragItem]` view can be dragged out to another app or onto a `(fileDrop)` view, as on macOS; a drag that carries both a uri list and other text arrives with its urls only.
