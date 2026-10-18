---
__default__: patch
---

A frame of a `@keyframes` animation or a transition that only paints (a `transform`, an `opacity`, a colour) no longer plans layout again or reads boxes back from native. A spinner or a pulsing skeleton commits on every frame for as long as its screen is open, and each frame was paying for the whole screen's block, grid and positioning work, which on a phone left little of the JS thread for touches.
