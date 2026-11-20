---
__default__: patch
---

On Linux, the desktop host leaves out the maps module, so `MapView` reads as absent there, as the OS support table says, instead of finding a module that has no map views behind it.
