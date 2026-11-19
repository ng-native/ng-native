---
__default__: patch
---

On macOS an `<image>` that loaded quickly, such as a local `require()` asset from the dev server, no longer goes blank when the view lays out again, and `(load)` reports the image's size in pixels rather than three times it.
