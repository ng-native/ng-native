---
'__default__': patch
---

An animation whose keyframes hold nothing no longer commits a frame for as long as it runs.

A `@keyframes` whose only declarations are refused at build time, as one with a `var()` in it is, left an animation with nothing to paint that was still restyled and committed on every frame, forever where it is `infinite`. It now commits nothing while it plays, its `animationstart` and `animationend` are sent as before, and one that never ends leaves the frame loop nothing to run for.
