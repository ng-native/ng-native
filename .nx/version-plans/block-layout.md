---
__default__: minor
---

`display: block`, `flow-root` and `inline-block` are laid out as block containers, and an element that relied on them being read as `flex` needs `flex` instead.

Adjoining vertical margins collapse between a block's children, between a block and its first or last child, and through an empty block; the flex properties on a block and on the boxes in its flow are ignored, as a browser ignores them; and a block whose children are all `inline-block` lays them out in lines that wrap. Before, each was read as `flex`, so margins added and `flex-direction: row` on a `block` made a row. `mount()` also takes `layoutConformance: 'strict'`, which lays the app out without Yoga's legacy quirks: a percentage inset or size of a `position: absolute` box is of its container's padding box, as CSS has it.

An inline-block or inline-flex box among blocks, alone or with others, is on a line as tall as the font's line height, as in a browser: the box sits on the baseline, the room under it is kept below the line as a margin of the box, and a line it wraps onto starts under that room. A `box-sizing: content-box` block holding only inline-level boxes is as tall as its lines: one line tall when they fit on one line. A percentage height of a box on a line is of the block it is in. A box beside text sits on the baseline of that text, and a box `vertical-align` sets to the top, the middle or the bottom of its line has no room under the baseline added under it. A line taller than its block with a height of its own reaches down out of it from the top. A clipped flex box or span on a line keeps the baseline of its text, and only an inline-block that clips sits on the baseline by its bottom edge.
