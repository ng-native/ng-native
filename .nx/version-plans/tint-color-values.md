---
__default__: patch
---

`tint-color` and `shadow-color` in a stylesheet take the values `color` takes: `platform-color()`, a relative color or `color-mix()` of a token, a `light-dark()` side holding either, and `currentColor`, each of which was dropped at build time as "not mapped yet" or sent to native as a word it reads no color in.

lightningcss knows neither property, so each arrived as raw terms and was read as a color written out or a lone `var()` only. A value it cannot take, such as `inherit`, is now dropped with a warning saying why, where the word was sent on as the color.
