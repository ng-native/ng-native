---
__default__: patch
---

The macOS desktop host tiles an image with `resizeMode: 'repeat'` from the top left corner at its pixel size divided by its source's `scale`, as React Native iOS does, where it stretched the image to fill its box.
