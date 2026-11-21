---
__default__: patch
---

On Linux, text aligns by the layout's direction whatever its script, as on macOS and iOS: `text-align: right` puts Hebrew or Arabic text on the right, and text with no `textAlign` starts at the layout's leading side. Before, Pango swapped left and right for a right-to-left paragraph.
