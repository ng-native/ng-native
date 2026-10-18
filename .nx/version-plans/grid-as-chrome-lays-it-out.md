---
'__default__': patch
---

A CSS grid is laid out closer to Chrome: its items sit inside its border once, a padding written as a percentage is of the box it is in, a `box-sizing: content-box` container or item is no longer its padding taller, an item's `left`, `top`, `right` and `bottom` move it, and its `flex-basis` is ignored. A grid with a width of its own keeps it, one nothing stretches is as wide as its tracks (even with no items, or as an item of another grid), `min-height`, `max-height`, `max-width` and `min-width` hold its tracks, it shrinks and stretches in a flex container as a box does, and a grid stretched in another grid's row stretches its own rows.
