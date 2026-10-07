---
'__default__': patch
---

A CSS transition of `opacity`, a transform, a `background-color` or a border color is played by native, with no frame of it in JavaScript.

A press that fades, slides or tints something was a commit on every frame for as long as it took, on press and again on release. It is now a commit to start and a commit to end, as a `@keyframes` animation of opacity and transforms already was. A transition of a size, a text color or a shadow, and one with a delay, is eased from JavaScript as before.
