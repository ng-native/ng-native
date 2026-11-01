---
__default__: patch
---

A percentage width capped at `max-content` is the smaller of the two, a `width: fit-content` or `max-content` capped box between a `left` and a `right` stays as wide as its content, and a percentage `flex-basis` in a box fitted to its content is a share of that box's width, as in a browser.

These change committed layout. A `width: 50%; max-width: max-content` box with wide content took all of it, and now stops at the percentage: `maxWidth` is committed as the percentage, and a height capped the same way behaves alike. An absolute or fixed box written as wide as its content filled the room between its insets, and is now fitted within what they and its margins leave, which needs layout read back from native and costs two more commits when something in it changes. An item with `flex: 0 0 50%` in a `width: fit-content` row was as wide as its content, and now takes half of the row. A basis of `0%` is unchanged. With `direction: rtl` on a subtree, such a box between two insets sits at the left inset.
