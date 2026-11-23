---
__default__: patch
---

A `repeating-linear-gradient(...)` along a side with percentage stops now compiles to a tile that percentage of the box, a period under 1px is dropped with a build warning, and an ordinary background image that wins over a repeating gradient no longer takes the tile's size, position and repeat.

Percentage stops are lowered only along a side (`to bottom`, `to right`, `90deg` and the like) and only when every positioned stop is a percentage or 0; at any other angle, or mixed with `px` or `rem` stops, they are still dropped with a warning. A period under 1px used to compile to a tile for every stripe, where Chrome paints whichever stripe each device pixel lands on rather than their average color. The tile's placement now belongs to its image: where a stronger rule, an important declaration or the element's own style gives an ordinary `background-image`, that image is placed by what a weaker rule set or what was written after the tile, as in a browser, where it used to keep the tile's placement.
