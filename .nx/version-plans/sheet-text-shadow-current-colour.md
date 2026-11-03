---
__default__: patch
---

A `text-shadow` with no colour, or in `currentColor`, in a stylesheet is now drawn in the element's text colour, as Chrome draws it, where it was dropped with a warning. It follows the text colour when that changes, as a `box-shadow` with no colour does.
