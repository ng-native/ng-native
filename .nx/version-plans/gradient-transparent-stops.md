---
__default__: patch
---

A gradient through a transparent or partly transparent stop paints the fade a browser does, where iOS drew a grey or muddy band through it: `linear-gradient(transparent, white)`, `linear-gradient(red, transparent, blue)`, `linear-gradient(rgb(0 0 0 / 0.1), white)`, and the same with a token or a `color-mix()` as the stop. A stop at no opacity is committed in the colour of the stop it fades to or from, one between two different colours as two stops at one position, and stops are written in between two of different colour and opacity, so the `colorStops` committed for such a gradient differ from the ones written. A token bound on an element as `hsl()` or `hwb()` is also read as a colour by a `color-mix()`, a relative colour and a transition.
