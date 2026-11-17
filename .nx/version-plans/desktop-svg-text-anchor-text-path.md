---
__default__: patch
---

On macOS the desktop host draws SVG `text-anchor` (start, middle and end) and text along a `<textPath>`, where it drew all text start-anchored and drew nothing on a path.

Anchors apply per text chunk, as in Chrome: a span with its own `x`, or off a path its own `y`, starts a chunk, anchored by its own `text-anchor`; on a `<textPath>` a span's `y` places nothing and starts no chunk. On a path each glyph (a grapheme cluster, drawn as its run shaped it, kerning and joined forms kept) is placed at the point its middle reaches, turned with the path, from `startOffset` (a length or a percentage of the path), with `side="right"` setting it along the path reversed; a glyph whose middle falls off the path is not drawn. A `<tspan>`'s or `<textPath>`'s `opacity` now applies once to all the text it holds. A character's `x`, `y`, `dx` and `dy` come from the innermost element that sets them for it, as in Chrome, so a `<text>`'s `dx` and `dy` reach the first glyph on its `<textPath>` and a `<tspan>` with no characters places nothing. `method` and `spacing` are not read, and `<foreignObject>` content still does not draw.
