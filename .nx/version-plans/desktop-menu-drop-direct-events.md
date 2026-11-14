---
__default__: patch
---

On macOS, a `[contextMenu]` choice and a `(fileDragEnter)`, `(fileDragLeave)` or `(fileDrop)` reach the element they happened on only. A menu or drop zone inside another one handed them on to the one around it as well, so choosing an item in the inner menu ran the outer menu's handler too, and a drop on the inner zone also dropped on the outer.
