---
__default__: patch
---

On macOS an svg draws its markers, patterns and filters: markers at a path's or line's vertices, turned with `orient`, patterns filling or stroking with their tile, and filters made of `feGaussianBlur`, `feOffset`, `feColorMatrix`, `feFlood`, `feComposite` and `feMerge`, which a drop shadow is drawn with.
