---
__default__: patch
---

On macOS `ImageEditor`, `TextRecognition`, `Fonts`, `Printing`, `MediaLibrary`'s `createAsset` and a request body's file read only what `FileSystem` can (the app's folders, the files and folders the user picked and the declared `capabilities.paths`) and a packaged app's own assets. Any other path is refused with an error naming it.
