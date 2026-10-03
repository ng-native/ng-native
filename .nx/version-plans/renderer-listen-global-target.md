---
__default__: patch
---

`Renderer2.listen('window', ...)`, and the same on `'document'` and `'body'`, attaches to nothing, where it threw `Cannot create property 'listeners' on string 'window'`.
