---
__default__: patch
---

A `@keyframes` animation that sets only `opacity` and transforms is played by native, with nothing running in JavaScript while it plays: a spinner or a pulsing skeleton no longer commits on every frame for as long as its screen is open. Animations of anything else, delayed ones, and every animation without the native animated module play from JavaScript as before.
