---
__default__: patch
---

`<virtual-list>` and `<section-list>` now render ahead of the scroll while the JS thread is idle, so a fast fling lands on rows already drawn, and take a `windowSize` input that caps how far.

The window used to be the visible rows plus `overscan` rows on each side, so a fling outran it and showed blank space. Now, once window changes stop for 50ms, the window grows a viewport at a time, ahead of the scroll direction first, up to `windowSize` viewports in all (5 by default; `FlatList` defaults to 21): about two thirds of the extra viewports ahead of the scroll and the rest behind. When the scroll turns, what was ahead is cut back to what is kept behind. More rows are rendered than before while the list is at rest. `windowSize` of 1 keeps the old window.
