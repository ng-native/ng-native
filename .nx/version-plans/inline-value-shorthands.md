---
__default__: patch
---

`border`, `outline`, `box-shadow`, `background`, `font` and `text-decoration` in a `style` attribute or a `[style]` binding now draw, committing the props a stylesheet commits, where each was committed as text native does not read.

The same goes for `border-top` and the other sides, logical sides included, and for `border-width`, `border-color` and `border-radius` of several values. A value these do not read (a `background` with a position, size, `url()` or a token in a gradient, a `box-shadow` with a token beside other parts, a `font` with `small-caps`) is dropped with a warning in development. `[style.border-color]` and the other colour properties except `color` take `currentColor`.
