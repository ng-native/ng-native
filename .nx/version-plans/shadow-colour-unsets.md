---
__default__: patch
---

A shadow or text shadow whose colour reads a custom property that is set but holds no colour now draws no shadow, as in a browser, rather than taking the `var()`'s fallback, and a shadow with no colour written is drawn in the node's own colour rather than black.

The same holds for a `color-mix()` of such a token, in a stylesheet and set on an element: the colour it makes is unset. A shadow's `var(--x,)` with no other colour, as in `box-shadow: var(--x,) 0 0 4px`, is drawn in the node's colour when `--x` is `inset` or unset, in `--x` when it is a colour, and not at all otherwise.
