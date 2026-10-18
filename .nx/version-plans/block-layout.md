---
__default__: minor
---

`display: block`, `flow-root` and `inline-block` are laid out as block containers. Adjoining vertical margins collapse between a block's children, between a block and its first or last child, and through an empty block; the flex properties on a block and on the boxes in its flow are ignored, as a browser ignores them; and a block whose children are all `inline-block` lays them out in lines that wrap. Before, each was read as `flex`, so margins added and `flex-direction: row` on a `block` made a row. An element with `block` and flex properties that relied on the flex reading needs `flex` instead. `mount()` also takes `layoutConformance: 'strict'`, which lays the app out without Yoga's legacy quirks: a percentage inset or size of a `position: absolute` box is of its container's padding box, as CSS has it.
