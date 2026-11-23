---
__default__: patch
---

A `<virtual-list>` with `stickyHeader` now draws its header at the top of the list until the list first scrolls, rather than moved down by its own height over the first rows.

That showed wherever no scroll event arrives before the list first moves: on Android, and on iOS when nothing adjusts the scroll view's content inset as it appears, such as under a native stack header that is not translucent.

A `stickyHeader` that changes size while the list is scrolled now stays pinned at the leading edge, and so do the list's pinned sticky rows. They used to be placed against the header's size at the last scroll event until the next one.
