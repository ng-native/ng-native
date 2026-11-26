---
__default__: patch
---

`<virtual-list>` pins sticky rows at more than one level with `[virtualListStickyLevel]`, a function that gives each row's level: a year at the leading edge, its month under it and the day under that.

A row pins under the nearest row before it of each level further out, and the next row at its own level or further out pushes it off. `[virtualListMaxStickyLevels]` limits how many levels pin, the rows of `stickyIndices` are at level 0, and with `[virtualListNumColumns]` a sticky row of any level takes a line to itself. Rows that size themselves pin at every level too, each under the rows pinned over it at their measured heights.
