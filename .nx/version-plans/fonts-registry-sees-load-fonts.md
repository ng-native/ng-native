---
__default__: patch
---

`inject(Fonts)` now reports the faces `loadFonts()` registered, so `families()` and `has()` update once they load, where they kept the result of their first read for the life of the app.
