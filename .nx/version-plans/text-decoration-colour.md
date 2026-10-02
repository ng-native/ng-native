---
__default__: patch
---

A text decoration on an element is now drawn under the text inside it in that element's decoration colour, or its text colour when it sets none, as Chrome draws it, and `text-decoration: underline currentColor` sets the colour of the text rather than none.

Text that declares a line of its own still draws it in its own colour, and a text's `text-decoration-color` without a line of its own no longer recolours a line it is given. Android draws every line in the text's colour, as React Native's Android text has no decoration colour.
