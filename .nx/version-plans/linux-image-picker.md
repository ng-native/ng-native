---
__default__: patch
---

`ImagePicker.pick()` works on Linux: the GTK host opens the desktop's file chooser through the FileChooser portal, or GTK's own where no portal answers, with an image or video filter, and answers each file with its uri in the app's caches, size, type, MIME type and file size. An MP4 or QuickTime video also has its duration. There is no camera on Linux, so `capture()` resolves to an empty list.

On macOS and Linux, a picked image has `base64` and `exif` when the options ask for them. `exif` is read from a JPEG's own EXIF.
