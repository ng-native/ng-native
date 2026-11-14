---
__default__: patch
---

On macOS every module and view that takes a path or a `file:` uri from JavaScript reads only what `FileSystem` can (the app's folders, the files and folders the user picked and the declared `capabilities.paths`) and a packaged app's own assets: `ImageEditor`, `TextRecognition`, `Fonts`, `Printing`, `MediaLibrary`'s `createAsset`, a request's file url and body, `Image.getSize`, `<image>`, `<expo-image>` and SVG image sources, audio and video sources, a web view's file page, `Asset.downloadAsync`, `Sharing.share`, a `dragItem`'s files and `Shell.openPath` and `showItemInFolder`. `SQLite` opens, makes and deletes a database only where `FileSystem` can write. Any other path is refused: with an error naming it where the call can fail, and otherwise left undrawn, left out of a drag, or answered false by `Shell`.
