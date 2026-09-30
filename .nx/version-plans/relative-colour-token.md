---
__default__: patch
---

A custom property can now hold a relative colour of a token, such as `--tint: oklch(from var(--brand) l c h / 50%)`, in a stylesheet and set on an element, where before a stylesheet stopped the build on it and an element left it unset.

It is worked out where it is set, in any of `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()` and `oklch()`, with channels written as keywords, numbers, percentages, angles or `calc()` of keywords and numbers, and it follows a theme or an ancestor that changes the token it reads. Set on an element, a relative colour inside a `color-mix()`, and one of a colour written out, `rgb(from red r g 255)`, now resolve as they do in a stylesheet.
