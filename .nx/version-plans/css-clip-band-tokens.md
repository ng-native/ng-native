---
__default__: patch
---

In a library's sheet under `provideWebCompat()`, a clip band whose edge is a token, `clip-path: polygon(0 0, var(--position, 50%) 0, var(--position, 50%) 100%, 0 100%)`, is no longer refused: the engine settles it for each image, so the band follows the token as a script sets it and goes back to the fallback as it is taken away.
