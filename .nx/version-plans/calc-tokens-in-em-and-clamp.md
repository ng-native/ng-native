---
__default__: patch
---

A `calc()` of tokens in which a token holds a length in `em` or a viewport unit now works, where it was dropped: `calc((var(--height) - var(--line)) / 2)` with `--line: 1.4em` is worked out against the font size where the sum is used, as a browser does, whether it is a declaration or a custom property that holds the sum. An `em` or a viewport unit written beside a token is worked out the same way. One such unit can be in a sum: a sum of an `em` and a `vw` is dropped, with a warning at build time where both are written in it.

A custom property that holds a `clamp()` of tokens, such as Taiga UI's `--t-zoom: clamp(0, (var(--tui-font-scale-factor, 1) - 1.4999) * 10000, 1)`, is no longer dropped at build time. It is worked out on device as `min()` and `max()` of tokens already were, and so is a `clamp()` of tokens written in a declaration.

Reading a custom property that holds a length in `em` from script, with `getPropertyValue` or `Engine.token`, now gives its text, such as `1.4em`, where it gave `[object Object]`.
