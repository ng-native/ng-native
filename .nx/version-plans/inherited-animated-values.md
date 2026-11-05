---
__default__: patch
---

A property children inherit now eases in them while an element transitions or animates it: the text inside a view whose `color` transitions takes each frame's colour, where it jumped to the end colour at once, and the text inside a view whose `color` a `@keyframes` animation plays follows the frames, where it kept no colour at all. A child that sets the property itself keeps its own.
