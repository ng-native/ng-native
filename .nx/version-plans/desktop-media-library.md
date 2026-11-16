---
__default__: patch
---

On macOS `MediaLibrary` answers from the desktop host's `NgNativeMediaLibrary`, over PhotoKit, and `ImagePicker.pick()` from `NgNativeImagePicker`, the system's photo picker, at a picker's size (780 by 560 points, or smaller in a smaller window). The library is read and written only with the user's permission, which is asked only when the app declares the photo library usage strings; without it, queries answer empty and `save()` answers null. `capture()` answers no assets on macOS.
