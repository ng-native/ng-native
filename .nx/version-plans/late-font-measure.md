---
__default__: patch
---

Text laid out while `loadFonts()` is still loading its face, as when the app mounts without awaiting it, now takes the face's size once it registers, where on Android it kept the fallback font's width and wrapped and clipped.

React Native caches a text's measurement by its family name, so the engine now lays such text out without the name until the face registers, and then with it, measured fresh.
