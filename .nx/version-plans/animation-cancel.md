---
__default__: patch
---

An `(animationcancel)` listener now fires when a running animation stops before it ends, because the element no longer asks for it, asks for another by name, or its `@keyframes` went in a hot swap, as a browser fires it.
