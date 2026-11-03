---
__default__: patch
---

A `box-shadow` with no colour in a stylesheet is now drawn in the element's text colour, as Chrome draws it, where it was dropped with a warning, and a stylesheet's `font` shorthand now puts `font-style` back to `normal`, so a weaker rule's italic no longer shows through.

The shadow follows the text colour when it changes, own or inherited, as a border with no colour does. Such a shadow in a `@keyframes` frame is still dropped with a warning, as other uses of `currentColor` there are.
