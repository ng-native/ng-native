---
'__default__': patch
---

A `@keyframes` animation of opacity or transforms no longer leaves its view at its first frame when the view is made in a long task.

Native plays such an animation, and one shorter than the task that made its view finished before
the view was mounted: the view then stayed transparent or scaled, as an overlay's panel did the
first time it opened. Native now writes the animation's last frame as it ends.
