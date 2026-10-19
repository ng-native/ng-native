---
__default__: patch
---

`extendNodes()` lets a package replace `tagName`, a getter the engine only reads out for Angular, as it may replace `classList`; every field the engine writes on a node is still refused.
