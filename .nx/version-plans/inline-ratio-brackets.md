---
__default__: patch
---

An `aspect-ratio` of a width and a height set in a style, such as `16 / 9` or `calc(16 / 9) / 1`, is now committed as the one number native takes, and a style value or a custom property with a bracket left open, such as `translateX(1px`, is read with it closed, as Chrome reads both.

Before, a ratio with math on either side reached native as text and drew no ratio, and a value with a bracket left open was dropped or reached native as text. A ratio with a side of 0, or with `auto` in it, still reaches native as it is written.

A ratio in a style with a side CSS reads no number from, such as `1 / 0x10`, `1 / Infinity` or `1 / -2`, or with a third side, is dropped with a warning, so the stylesheet's ratio shows, as in Chrome.
