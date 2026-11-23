---
__default__: patch
---

A `<virtual-list>` header that changes size while the list is scrolled now updates the rendered rows, `(endReached)` and `(viewableItemsChanged)` for the rows it moved at once, and a `stickyHeader` is moved by native with the scroll, as sticky rows are, so it no longer trails the list mid-fling.

The header resize fix applies on every platform. Before, the list kept judging which rows to render, where the end was and what was viewable against the header's old size until the next scroll event, so rows the header moved onto the screen could be missing. A resize held by `maintainVisibleContentPosition` is unchanged.

The pinned header is moved natively wherever sticky rows are, as on iOS and Android, with its committed `transform` written once scrolling pauses; elsewhere it is still translated from each scroll event.
