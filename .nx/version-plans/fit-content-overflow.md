---
__default__: patch
---

A box in the flow that is `width: fit-content` and holds a percentage width or an item that grows is no narrower than content that cannot get narrower, and overflows its container as in a browser, where it was held to the container's width.

For example, a `w-fit` row holding a `width: 500px` box and a `flex-1` label in a 362 point column is 530 wide, and the label keeps its 30, where the row was 362 wide and the label had no width. While such a box is measured, the items whose share is set aside no longer shrink, and nothing out of the flow in it counts. A box in it with a width in points counts at that width, not for what overflows it, one with a `max-width` in points counts no wider than that, an item of a row with a `flex-basis` in points that does not grow counts at that basis, and a box moved by a `left` or `right` in points counts where it was before the move. Both hold for a box on a line, such as an `inline-flex` one, as well. A `width: fit-content` box between two insets, and one holding no percentage width or growing item, is still held to the room it has.

A change to a box's `box-sizing` is now taken as one that moves boxes, as a change to its padding is, so a box around it that is as wide as its content follows it, where it kept the width it had. On iOS and Android the box whose `box-sizing` alone changed still keeps its old size, since React Native's Yoga does not compare `boxSizing`.
