---
__default__: patch
---

On macOS `ImageEditor` edits images through the desktop host's `NgNativeImageManipulator`, over ImageIO and Core Graphics: resize, rotate, flip and crop, saved as JPEG or PNG. Saving as WebP rejects, since macOS cannot write it.
