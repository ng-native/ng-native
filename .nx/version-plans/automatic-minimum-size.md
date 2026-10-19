---
__default__: patch
---

`min-width: auto` and `min-height: auto` keep a flex item that shrinks at the size of its content, as a browser does.

An icon in a crowded row keeps its width, and a box in a column that is too short keeps its height.
The engine applies it down a column, and along a row when no text in the item can wrap. Yoga reads
them as no minimum, so they are not passed to it. An item that relied on shrinking below its content
sets `min-width: 0`.
