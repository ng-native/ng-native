---
__default__: patch
---

A row as wide as its content, such as one with `align-self: flex-start` in a column, stays as wide as its items when one of them grows by `flex-grow` or React Native's `flex`, as in a browser, where it filled all the room it could have; and a `flex` of several values, a keyword or a basis in a `style` attribute or a `[style]` binding commits its grow, shrink and basis.

React Native's Yoga gives such a row all the room on offer once any item grows, so a segmented control whose tabs are `flex: 1` filled the screen. The engine fits the row to its content with the items' growth set aside, as it already did for items with a percentage basis, and commits it at that width, which costs two more commits when something in the row changes. A row that is stretched, or has a width, still shares all of it among its items.

`style="flex: 1 1 auto"` was committed as a string native drops, so the item did not grow at all. A `flex` such as `1 1 auto`, `2 3`, `none`, `auto` or `30%` now commits `flexGrow`, `flexShrink` and `flexBasis`, as a stylesheet does, and one that is no CSS `flex`, such as `1 -1` or four values, is dropped with a warning in development. One number, `flex: 1`, is still React Native's own `flex` in a style attribute, a binding and a style object.
