---
__default__: patch
---

A streaming `markdown` element holds back a last line of only a list marker (`+`, `*`, `1.` or `1)`) until the line ends, so it no longer draws as text in the paragraph above until the item's first letter arrives.

The hold applies after any quote markers too, and clearing `streaming` still draws the source as it is.
