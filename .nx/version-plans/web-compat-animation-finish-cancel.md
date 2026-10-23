---
'__default__': patch
---

Under `provideWebCompat()`, `finish()` and `cancel()` on an `@keyframes` animation from `element.getAnimations()` now end it on the view: `finish()` draws it at its last frame where it fills forwards and at its resting style where it does not, and `cancel()` at its resting style, fill or not, and leaves it cancelled while the element asks for the same animation. One React Native's animated module was playing natively is stopped there, where before it played on to its end. `cancel()` of one that has ended and is held at its last frame by its fill lets go of that frame. A transition's `finish()` and `cancel()` still settle `finished` and `playState` only. The engine has `endPlaying(node, 'finish' | 'cancel')` for this.
