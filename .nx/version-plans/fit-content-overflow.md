---
__default__: patch
---

A box in the flow that is `width: fit-content` and holds a percentage width or an item that grows is no narrower than content that cannot get narrower, and overflows its container as in a browser, where it was held to the container's width.

For example, a `w-fit` row holding a `width: 500px` box and a `flex-1` label in a 362 point column is 530 wide, and the label keeps its 30, where the row was 362 wide and the label had no width. While such a box is measured, the items whose share is set aside no longer shrink, and nothing out of the flow in it counts. A box in it with a width in points counts at that width, not for what overflows it, and a box moved by a `left` or `right` in points counts where it was before the move. Both hold for a box on a line, such as an `inline-flex` one, as well. A `width: fit-content` box between two insets, and one holding no percentage width or growing item, is still held to the room it has.
