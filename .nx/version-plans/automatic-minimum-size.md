---
__default__: patch
---

`min-width: auto` and `min-height: auto` keep a flex item that shrinks at the size of its content, as a browser does: an icon in a crowded row keeps its width, and a box in a column that is too short keeps its height. The engine applies it down a column, and along a row when no text in the item can wrap. They were passed to Yoga, which reads them as no minimum.
