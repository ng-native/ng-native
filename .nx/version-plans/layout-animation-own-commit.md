---
'__default__': patch
---

`LayoutAnimation.animate()` animates its own change while a CSS transition or animation driven from JavaScript is playing, where the change landed in one step and a frame of the other animation took the configured animation.

`animate()` now runs change detection and commits the change before it returns, and configures the animation as that commit is handed to the platform. A change that commits nothing configures nothing, so a later unrelated commit is no longer animated in its place, and the promise resolves at once. A change made after `animate()` returns, rather than inside the function passed to it, lands in a later commit and is not animated.
