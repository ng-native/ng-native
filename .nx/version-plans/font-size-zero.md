---
__default__: patch
---

A `font-size` of 0 no longer throws on Android or draws its text at the default size on iOS: the engine commits a size of 0.001 in its place, too small to see.

React Native on Android requires a font size above zero, so `font-size: 0`, `0em` or a `calc()` clamped to 0 threw `FontSize should be a positive value`, from a stylesheet, an inline style or a token alike. Android draws no text smaller than one device pixel, so there the text leaves a faint mark one pixel tall in a line box about 1dp tall, where Chrome leaves no box.
