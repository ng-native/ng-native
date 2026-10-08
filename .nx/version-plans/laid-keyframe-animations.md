---
'__default__': patch
---

A `@keyframes` animation of two frames that sets only sizes and places, a panel sliding open from `height: 0`, is committed once at its last frame and moved there by native's layout animation, where it was a commit on every frame; and of several transitions or animations of a size that start in one commit and take different times, native plays the longest and the rest are eased from JavaScript, where none of them was native's.
