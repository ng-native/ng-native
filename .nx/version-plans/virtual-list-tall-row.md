---
__default__: patch
---

A `<virtual-list>` or `<section-list>` scrolled partway into a row taller than the rows after it, such as a photo over its comments, now renders every row down to the end of the viewport. Before, it stopped about a viewport below the top of that row, leaving the rest of the screen blank until the tall row scrolled away. Horizontal lists, measured rows and fixed heights all had it.
