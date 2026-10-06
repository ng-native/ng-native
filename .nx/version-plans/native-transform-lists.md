---
'__default__': patch
---

A `@keyframes` animation whose transform gains or loses a function between frames is played by native.

An animation from `transform: rotate(180deg) translateX(-10px)` to the element's own `rotate(180deg)` was played from JavaScript, a commit a frame for as long as it ran, because the two lists are of different lengths. A list that is the start of a longer one is now the longer one with the rest at their identity, as CSS eases it, so native plays the animation and JavaScript does nothing while it runs. Lists that start with different functions are still played from JavaScript.
