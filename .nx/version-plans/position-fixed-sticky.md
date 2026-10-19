---
__default__: patch
---

`position: fixed` and `position: sticky` are supported, where both were dropped with a warning.

A fixed box is positioned against the page it is on, the screen or modal it is inside or else the whole app, wherever in the page it is written. Inside a scroll view or a box that clips it is committed under the page instead, so it neither scrolls nor is clipped, while it is still styled and bubbles events as its parent's child. A sticky box sticks `top` from its scroll view's top edge (or `left`, in a horizontal one) at any depth inside it, and stops at the end of its parent. A sticky box with a `transform` of its own is drawn with both, as in a browser. In a grid, a fixed box is placed against its page and a sticky item stays in its area. A `position: absolute` child of a grid is placed against the lines its `grid-column` and `grid-row` name, or at the grid's padding edge with no inset, moved by its `justify-self` and `align-self`.
