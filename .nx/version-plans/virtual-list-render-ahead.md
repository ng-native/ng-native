---
__default__: patch
---

`<virtual-list>` and `<section-list>` now render ahead of the scroll while the JS thread is idle, so a fast fling lands on rows already drawn, and take a `windowSize` input that caps how far.

The window used to be the visible rows plus `overscan` rows on each side, so a fling outran it and showed blank space. Now, once window changes stop for 50ms, the window grows a viewport at a time, ahead of the scroll direction first, up to `windowSize - 1` viewports beyond the visible one (`windowSize` is 5 by default; `FlatList` defaults to 21), with about two-thirds of them ahead of the scroll and the rest behind. The `overscan` rows and the rows the viewport reaches into are rendered on top of that. When the scroll turns, what was ahead is cut back to what is kept behind. `scrollToIndex`, `scrollToOffset` and `scrollToEnd` to a row outside the window start the fill over, so a jump renders the visible rows and the overscan, not the whole filled window, in one pass. More rows are rendered than before, and each window change costs more change detection once the window is full. `windowSize` of 1 keeps the old window.
