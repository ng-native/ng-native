---
__default__: patch
---

`<virtual-list>` and `<section-list>` now render ahead of a fast scroll, and take a `velocityLead` input that sets how far.

While the list scrolls, the window reaches past the viewport in the direction of the scroll by about the distance the list covers in `velocityLead` milliseconds (500 by default) at its recent speed, in steps of a quarter viewport and up to three viewports, so a fling lands on rows already drawn. The reach drops back as the scroll slows, and 200ms after the last scroll event. The scroll event that reports where `scrollToIndex`, `scrollToOffset` or `scrollToEnd` landed does not count toward the speed; the frames of an animated scroll after it do, as any scroll's do. More rows are rendered during a fast scroll than before. `velocityLead` of 0 keeps the previous window.
