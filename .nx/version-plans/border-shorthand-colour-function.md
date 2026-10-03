---
__default__: patch
---

A `border`, a per-side border or an `outline` shorthand now takes a `color-mix()` of a token as its color, as in `border: 1px solid color-mix(in srgb, var(--tint) 35%, transparent)`, where it was dropped whole with a message about arithmetic.

The color is worked out on device, as `border-color` has it, and follows the token. With the token unset the whole shorthand is invalid and no border is drawn, as in a browser.

A `color-mix()` of a token with `currentColor` as its other side now mixes the text color, in a shorthand and in `border-color`, `background-color` and the other color properties, where the declaration was dropped with no message.
