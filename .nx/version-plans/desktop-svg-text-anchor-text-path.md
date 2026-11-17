---
__default__: patch
---

On macOS the desktop host draws SVG `text-anchor` (start, middle and end) and text along a `<textPath>`, where it drew all text start-anchored and drew nothing on a path.

Anchors apply per text chunk, as in Chrome: a span with its own `x` or `y` starts a chunk, anchored by its own `text-anchor`. On a path each glyph is placed at the point its middle reaches, turned with the path, from `startOffset` (a length or a percentage of the path), with `side="right"` setting it along the path reversed; a glyph whose middle falls off the path is not drawn. `method` and `spacing` are not read, and `<foreignObject>` content still does not draw.
