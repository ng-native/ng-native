---
__default__: patch
---

`tint-color` and `shadow-color` in a stylesheet take a relative color or `color-mix()` of a token, a `light-dark()` side holding one, and `currentColor`, as `color` does, where the first three were dropped at build time as "not mapped yet" and `currentColor` was sent to native as a word it reads no color in.

lightningcss knows neither property, so each arrived as raw terms and was read as a color written out, a platform color or a lone `var()` only. A value it cannot take, such as `inherit` or a misspelled color name, is now dropped with a warning saying why, where the word was sent on as the color.
