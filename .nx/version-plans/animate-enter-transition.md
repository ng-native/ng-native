---
__default__: patch
---

`animate.enter` on a `transition` fades an element in once from its enter style, where it drew the element at rest, eased to the enter style and eased back, in twice the duration.

A class added to an element in the turn that created it is now its starting style, as in a browser, and is committed in that turn rather than a frame later. An `animate.enter` on `@keyframes` starts a frame sooner for the same reason.
