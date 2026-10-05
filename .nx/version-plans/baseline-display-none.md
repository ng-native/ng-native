---
'__default__': patch
---

A row with `align-items: baseline` keeps its height, and places what is in it, where an item's first box has `display: none`. Yoga read the item's baseline from the hidden box, which has no layout, so the row came to no height and nothing in it was drawn.
