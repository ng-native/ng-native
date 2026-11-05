---
__default__: patch
---

A `text-shadow` with no colour, or in `currentColor` written out, in a token or as the fallback of a `var()`, in a stylesheet is now drawn in the element's text colour, as Chrome draws it, where it was dropped with a warning. It follows the text colour when that changes, as a `box-shadow` with no colour does, and a text inside it with a colour of its own draws the shadow it inherits in that colour, as CSS inherits `currentColor` as the keyword.
