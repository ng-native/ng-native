---
__default__: patch
---

On Linux a view with a `transform` that has no perspective (a move, turn, scale or skew, including a worklet's or an animation's) now draws with its own background, corners and children under GSK's cairo renderer, which GTK uses on a machine with no GPU driver and the host uses for its screenshots. It drew as a plain pink box there. A transform with perspective still needs a GPU renderer.
