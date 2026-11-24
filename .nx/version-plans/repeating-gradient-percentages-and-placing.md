---
__default__: patch
---

A `repeating-linear-gradient(...)` along a side with percentage stops now compiles to a tile that percentage of the box, a period in `px` or `rem` under 1px is dropped with a build warning, and an ordinary background image that wins over a repeating gradient no longer takes the tile's size, position and repeat.

Percentage stops are lowered only along a side (`to bottom`, `to right`, `90deg` and the like) and only when every positioned stop is a percentage or 0; at any other angle, or mixed with `px` or `rem` stops, they are still dropped with a warning. A repeating gradient's `background-image` written after a `background-size`, or a `background-position` in lengths, in the same rule is now dropped with a warning, as it already was beside them in the `background` shorthand, where its tile used to replace the author's placement. A period in `px` or `rem` under 1px is dropped with a build warning: Chrome paints whichever stripe each device pixel lands on rather than their average color, so no tile matches it. The tile's placement now belongs to its image: where a stronger rule, an important declaration or the element's own style gives an ordinary `background-image`, that image is placed by what a weaker rule set or what was written after the tile, as in a browser, where it used to keep the tile's placement.
