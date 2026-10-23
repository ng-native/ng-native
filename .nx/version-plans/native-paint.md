---
__default__: patch
---

A view's `transform`, `opacity` or a colour changed again and again, such as a progress bar stepped every 50ms, is set on native with no commit from its third change within a second, so a run of such changes costs two commits rather than one each.
