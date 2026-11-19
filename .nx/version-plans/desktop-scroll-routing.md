---
__default__: patch
---

On macOS a vertical scroll over a horizontal scroll view, such as an image pager in a feed, now scrolls the view around it instead of stopping there, and an inverted list (`<virtual-list inverted>`) scrolls the way the user's scroll direction setting says rather than the reverse. Scroll views on macOS now honour `pagingEnabled`, report a trackpad drag with `(scrollBeginDrag)` and `(scrollEndDrag)` and its momentum or a page settling with `(momentumScrollBegin)` and `(momentumScrollEnd)`, and animate `scrollTo` and `scrollToEnd` when asked to.
