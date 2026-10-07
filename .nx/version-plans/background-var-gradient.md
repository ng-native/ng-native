---
'__default__': patch
---

`background: var(--x)` draws a gradient that a custom property set on an element holds, with the colour under it.

A library that works a gradient out as the app runs sets it as a custom property: a colour slider's track, or a colour area's two fades over a colour. It was read as a colour and came to nothing. `linear-gradient()` with a side or an angle and colour stops at percentages is read, in layers, over a last colour. A gradient in a stylesheet's own custom property is still refused where it is written, and native has no conic gradient. Only the shorthand reads one: `background-color: var(--x)` is a colour or nothing. The gradient is ranked in the cascade as a `background-image` is, so one a later rule declares, or an important one, stands over it.
