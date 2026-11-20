---
__default__: patch
---

`<virtual-list>` and `<section-list>` now render ahead of a fast scroll, and take a `velocityLead` input that sets how far.

While the list scrolls, the window reaches past the viewport in the direction of the scroll by about the distance the list covers in `velocityLead` milliseconds (500 by default) at its recent speed, in steps of a quarter viewport and up to three viewports, so a fling lands on rows already drawn. The reach drops back as the scroll slows, and 200ms after the last scroll event. The first scroll event after a `scrollToIndex`, `scrollToOffset` or `scrollToEnd` call does not count toward the speed. Later events do, including those of an animated scroll. More rows are rendered during a fast scroll than before. `velocityLead` of 0 keeps the previous window.
