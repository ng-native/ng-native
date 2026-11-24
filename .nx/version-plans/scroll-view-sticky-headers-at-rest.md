---
__default__: patch
---

A `<scroll-view stickyHeaderIndices>` header moved on the native side now moves along x once the scroll view turns horizontal, and is drawn at once where it belongs when its range changes, or it turns sticky, while scrolling is at rest. Before, it kept moving along y, and at rest it stayed where it was until the next scroll event.
