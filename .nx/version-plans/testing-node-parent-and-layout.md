---
__default__: patch
---

A node a query returns has `parent`, the node it is under, so a test can go from a text to the row around it, and `fireEvent.layout(node, { width, height })` sends a `(layout)` event with a frame; `fireEvent(node, 'layout', ...)` takes the frame bare, as `{ layout }`, or as `{ nativeEvent: { layout } }`.
