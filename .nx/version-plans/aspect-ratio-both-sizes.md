---
'__default__': patch
---

`aspect-ratio` is now left out for a box that has both a width and a height, as CSS has it: the ratio only works out a size that is `auto`.

Before, the ratio was committed with both sizes and Yoga took it over one of them: a box `24px` by `10px` with `aspect-ratio: 1 / 2` was 5 by 10 in a column and 24 by 48 in a row. A box that relied on the ratio beating a size it was given now takes the size: drop the size the ratio should work out, or set it to `auto`.
