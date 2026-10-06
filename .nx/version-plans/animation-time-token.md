---
'__default__': patch
---

An `animation` shorthand whose duration is a `calc()` on a token is read.

`animation: spin calc(2000ms * var(--speed, 1)) linear infinite` was dropped with "'animation' mixes var() with other values". The shorthand is now read with that time left out, and the time as `animation-duration` reads one, so the animation plays over the time the token scales it to.
