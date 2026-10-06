---
'__default__': patch
---

A `@keyframes` animation that moves an element by a percentage of its own size, `translateX(200%)`, is played by native.

Native interpolates points, so an animation with a percentage translate in a frame was played from JavaScript, a restyle and a commit on every frame for as long as it ran. The percentage is now worked out from the size the view is laid out at, after its first commit, and the animation is handed to native from there. An indeterminate progress bar that slid this way cost about a sixth of the JavaScript thread while it was on screen, and now costs none. A view that changes size while its animation runs keeps moving by the points of the size it started at until the animation starts again.
