---
'__default__': patch
---

An inline-block or inline-flex box among blocks is on a line as tall as the font's line height, as in a browser: the box sits on the baseline, the room under it is kept below the line, and a line it wraps onto starts under that room. A box alone among blocks is on such a line too, where it was laid out as a block of its own height.

A `box-sizing: content-box` block holding only inline-level boxes is a line tall, where it was the room under the baseline taller.

The room under a line's baseline is kept under each box on the line, as a margin, where it was padding of the line: a percentage height of a box on a line is of the whole line, as in a browser, a box beside text sits on the text's baseline and over its padding, a box of lines on a line is a line tall, and a box out of the flow after a line is placed under it.

A box of a known height on a line reaches as high as the line's strut, so a line in a block with a height of its own keeps the room over its baseline, and a line taller than its block reaches down out of it from the top, as in a browser.

A percentage height of a box on a line among blocks is of the block, where it was of the line. A box beside text in a box of a set height sits on the baseline of that text, at the top of the box.

An empty inline-flex box sits on the baseline by the bottom of its border box, with its bottom margin under it, and a box of a share of the height of a block with a height of its own reaches as high as the strut.

A clipped flex box or span on a line keeps the baseline of its text, as in a browser, where only an inline-block that clips sits on the baseline by its bottom edge. A line height under one written as a number, `line-height: 0`, is taken as the points it comes to for the room under a line, where it counted as a normal line height.

A box `vertical-align` sets to the top, the middle or the bottom of its line has no room under the baseline added under it.
