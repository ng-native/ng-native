---
__default__: patch
---

`background: <gradient>, var(--x)` now keeps or drops its gradients as Chrome does for a token holding a position, a size or a colour beside them, such as `10% 20%`, `center / cover` or `center red`, and a stylesheet's token can now hold a gradient.

A last layer the token holds is read as a whole: a position with an optional size, a repeat, an attachment, up to two boxes and a colour, each at most once, so `none none`, `fixed scroll` and `center center center` now make the shorthand invalid, as in Chrome. This holds for a token in a stylesheet, one set on an element, and a stylesheet fallback such as `var(--x, 10px 20px)`.

`--g: linear-gradient(...)` in a stylesheet is no longer dropped with a warning, and `background: var(--g)` draws it.

`background: var(--x)` of a colour now takes away an image a weaker rule declared, as Chrome does, where the image was left before.

`[style.background-image]` and a `background-image` in a `style` attribute now draw linear gradients and `none`, where the text was committed as it was before. Any other value, a token among them, is dropped with a warning.
