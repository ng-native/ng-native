---
__default__: patch
---

`<virtual-list>` and `<section-list>` now render ahead of a fast scroll, and take a `velocityLead` input that sets how far.

While the list scrolls, the window reaches past the viewport in the direction of the scroll by the distance the list covers in `velocityLead` milliseconds at its current speed (500 by default), up to three viewports, so a fling lands on rows already drawn. The reach drops back as the scroll slows or pauses, and `scrollToIndex`, `scrollToOffset` and `scrollToEnd` do not count as a fling. More rows are rendered during a fast scroll than before. `velocityLead` of 0 keeps the previous window.
