---
__default__: patch
---

`inherit` is taken for a property that has a value a child can simply have: `border-radius` and its corners, `width`, `height` and their limits, the font properties, `letter-spacing`, `text-align`, `text-transform`, `background-color` and `opacity`. The element has its parent's value, and none where the parent has none. It was refused as a CSS-wide keyword, so `border-radius: inherit` on a layer over a button left the layer square, and Tailwind's `bg-inherit` did nothing. For any other property it is still refused with a warning.
