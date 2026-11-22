---
__default__: patch
---

On Linux, text aligns by the layout's direction whatever its script, as on macOS and iOS.

In a left-to-right layout, `text-align: right` puts Hebrew or Arabic text on the right, and text with no `textAlign` starts at the left; a right-to-left layout mirrors both. A justified paragraph's last line follows the paragraph's own direction, as on macOS. Before, Pango swapped left and right for a right-to-left paragraph.
