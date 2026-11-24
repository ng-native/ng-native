---
__default__: patch
---

A `<scroll-view stickyHeaderIndices>` header moved on the native side now moves along x once the scroll view turns horizontal. While scrolling is at rest, a header whose range changes, or a child that turns sticky, is now drawn at once where it belongs, once the scroll view has had a sticky child to follow its offset by; before, it stayed where it was until the next scroll event. A scroll view that scrolled with nothing sticky still draws its first sticky child at the next scroll event.
