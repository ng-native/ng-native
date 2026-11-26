---
__default__: patch
---

A `<scroll-view stickyHeaderIndices>` header moved on the native side now follows a change of axis, and one that changes range or turns sticky at rest is drawn at once.

A header now moves along x once the scroll view turns horizontal. While scrolling is at rest, a header whose range changes, or a child that turns sticky, is drawn where it belongs at once, when the scroll view has reported an offset along its current axis while a child was sticky. Before, it stayed where it was until the next scroll event, which is still when it is drawn otherwise: after a change of axis, and after a stretch with nothing sticky.
