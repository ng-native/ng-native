---
__default__: patch
---

An item with a percentage `flex-basis` and a width of its own, such as `flex: 0 0 50%; width: 10px`, is measured at that width in a row kept from stretching by `align-self: flex-start` or its column's `align-items`, as in a browser, where it was measured at its content.

The share is then taken of the width the row comes to. A change to that width, set on the element or by a class, has the row measured again; before, a row fitted to its content kept its old width until something else in it changed.
