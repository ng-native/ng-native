---
__default__: patch
---

An `hsl()` made of tokens now reads a bare saturation or lightness, such as `hsl(var(--h) 100 50)`, as a percentage, as CSS Color 4 does, in a stylesheet and set on an element.

Before, `100` and `50` were read as 100 and 50 rather than 100% and 50%, and the colour came out wrong. The legacy comma syntax takes a percentage alone, so `hsl(var(--h), 100, 50)` is refused at build time and unset on an element, as a browser makes nothing of it; so is a hue written as a percentage.

An `hsl()` of tokens also matches a browser at the edges now: a saturation below 0 is none, an alpha outside 0 to 1 is clamped, and a colour past the edge of sRGB is clamped into it rather than printed with channels below 0 or above 255. A hue token in `turn`, `rad` or `grad` is read as the angle it is. And a custom property set on an element to a percentage or an angle, such as `--s: 50%` or `--h: 0.5turn`, is read as a fraction or in degrees where a number is wanted, as the same token in a stylesheet is.
