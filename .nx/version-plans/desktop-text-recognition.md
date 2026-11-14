---
__default__: patch
---

On macOS `TextRecognition` answers from the desktop host's `NgNativeTextRecognition`, over Vision as on iOS: `available()` is true, and `recognize()` reads the lines in an image file with their confidence and their boxes in pixels from the top left.
