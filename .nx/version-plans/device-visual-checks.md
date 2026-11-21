---
__default__: patch
---

Device tests can check one visual thing at a time and turn animations off: `toHaveStyle`, `toHaveSize`, `toBeWithin` and `toHaveColorAt` read what the engine committed, where native laid a node out and what it drew at a point, and `setAnimations(false)` (or `deviceTests({ animations: false })`) stops the engine's CSS transitions and `@keyframes`, UIKit's view animations on iOS and Android's animators.

`toHaveStyle` compares colours as hex, `rgb()` or `rgba()` with numbers, `hsl()`, `hwb()`, a name or the integer native is given, lengths in points, and a shorthand the engine commits as its parts (`borderRadius`, `borderWidth`, `borderColor`, `padding`, `margin`) by each part. `toHaveColorAt` samples a capture of the window on iOS, or Android 8 (API 26) or later, within one step of 255 on each channel by default, and `colorsAt` gives the colours themselves.

With animations off, from the next change on, a transition lands on its new value, a finite animation ends within two frames on its last frame where its fill mode keeps it, and one that repeats forever is not played, while one already running ends the next time its node is restyled; `Engine` takes the same as a `motion: 'off'` option and `setMotion()`. On Android the OS can refuse the animator scale, and `setAnimations` then resolves `false`.
