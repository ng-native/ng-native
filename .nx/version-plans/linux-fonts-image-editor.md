---
__default__: patch
---

On the GTK desktop host on Linux, `Fonts` loads a font file into fontconfig for the app's process, and text names it by the name it was loaded under, as on macOS. `ImageEditor` resizes, rotates, flips and crops with gdk-pixbuf and cairo, reading an image the right way up by its Exif orientation, and saves JPEG and PNG; WebP saves only where a gdk-pixbuf WebP writer is installed, and is refused otherwise.
