---
__default__: patch
---

`ImagePicker.pick()` opens the desktop's file chooser on Linux, and `capture()` resolves to an empty list there.

On the GTK host the chooser is the FileChooser portal's, or GTK's own where no portal answers, with an image or video filter. Each file is answered with its uri in the app's caches, size, type, MIME type and file size, and a video also has its duration when it is an MP4 or QuickTime file whose header can be read. There is no camera on Linux.

On macOS and Linux, a picked image has `base64` when the options ask for it, and `exif` when they ask for it and the file has any: a JPEG's own EXIF, or what the host read. Otherwise `exif` is `null`.
