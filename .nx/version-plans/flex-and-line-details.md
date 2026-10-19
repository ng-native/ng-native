---
__default__: patch
---

Smaller layout fixes come with block containers: `justify-self`, `vertical-align` lengths, `max-content`, the default width of text fields and relative offsets in wrapping rows.

`justify-self` places a block of a set width along its line in a block, where it was dropped with a warning, and a block with no width keeps no `auto` margins. `vertical-align` takes a length for a box on a line, how far over the baseline it sits. `max-content` is read as `fit-content` on a width or a height, and as a cap at the content on `max-width` and `max-height`, where it was dropped. A text field with no width is as wide as its `size` in characters, and a text area as its `cols`. A relatively positioned box in a wrapping row moves by its offset on every line.
