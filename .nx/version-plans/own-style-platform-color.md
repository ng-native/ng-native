---
'__default__': patch
---

`platform-color()` in a colour property of an element's own style (`style="color: platform-color(link)"`, `[style.color]` or `[style]`) commits the platform colour a stylesheet commits, where it was sent to native as text and drew no colour.

A stylesheet's `outline-offset` takes a `calc()` of lengths, `calc(2px * -1)`, and a function of a token, `calc(var(--x) * -1)` as Tailwind's `-outline-offset-(--x)` writes it, where both were dropped with a "not mapped yet" warning. A `calc()` with a percentage in it is dropped as `outline-offset: 37%` is.
