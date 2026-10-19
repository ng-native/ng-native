---
__default__: patch
---

`margin: auto` on a `position: absolute` or `fixed` box between two insets takes the room left over, as in a browser, when the box has a size of its own on that axis.

With no size there, the box fills the room between the insets and its automatic margins are 0, unless a min or max size clamps it, and then they share what is left.

`inset: 0; margin: auto` centres a box of a set size, where it stayed at the top left.
