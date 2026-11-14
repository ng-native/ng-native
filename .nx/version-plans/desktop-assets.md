---
__default__: patch
---

On macOS `assets()` loads through the desktop host's `NgNativeAsset`: an asset from the dev server is downloaded into the app's caches first, once per hash, and each loaded asset's `localUri` is its file. It threw `MissingModuleError` there before.
