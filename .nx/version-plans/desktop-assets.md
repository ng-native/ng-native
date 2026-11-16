---
__default__: patch
---

On macOS `assets()` loads through the desktop host's `NgNativeAsset`: an asset from the dev server is downloaded into the app's caches first, and one whose hash already has a file there is not downloaded again. Each loaded asset's `localUri` is its file.
