---
__default__: patch
---

`border: inherit` in a stylesheet now takes the parent's border, as Chrome does, and so do `border-width`, `border-color`, `border-style` and a side's width or colour.

Each is the parent's value side by side, over what a weaker rule set, and a side the parent set as a logical one (`border-inline-start`) is the physical side it lands on in the parent's direction. Tailwind 3's `divide-inherit` now compiles. Still refused: a side's style (`border-top-style: inherit`) and a side's shorthand (`border-top: inherit`), since native has one border style for the whole box; a logical side (`border-inline-start: inherit`); and `inherit` written in an element's own style.
