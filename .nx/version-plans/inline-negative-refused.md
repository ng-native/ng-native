---
__default__: patch
---

A negative written out in a style, such as `width: -4px`, `-1em` or `-10vw`, on a property with no value below zero is now dropped with a warning, as Chrome drops it, so the stylesheet's value shows instead.

This covers the props a math function below zero is clamped on: sizes, padding, font size, line height, border widths and radii, gaps, flex basis, grow and shrink, and aspect ratio. A negative `opacity` is kept, since CSS clamps it. This includes a binding such as `[style.width.px]` that comes out negative, which Angular sends as `-4px`. A style object's own numbers, such as `{ width: -4 }`, are React Native's and are unchanged.

A shorthand in a style with one part a browser drops, such as `padding: 1px -1px` or `padding: 1px calc(1px + 2)`, is now dropped whole with a warning, where its other sides were kept before.
