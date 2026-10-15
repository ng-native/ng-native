---
'__default__': patch
---

A `<markdown>` table scrolls sideways when it is wider than the page, with each column as wide as its widest cell (up to 280pt), instead of squeezing every column into the page's width.

A table is now a horizontal `scroll-view`, and each cell is a `view` that holds its text, so a custom `th` or `td` class styles the text inside a cell rather than the cell. A narrow table is drawn at its content's width.
