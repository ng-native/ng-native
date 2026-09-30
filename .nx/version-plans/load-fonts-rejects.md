---
__default__: patch
---

`loadFonts()` now rejects with a `MissingModuleError` when `expo-font` is missing, rather than throwing before a caller's `.catch` can see it, and resolves without reaching for `expo-font` when no sheet declares a face.

On iOS and Android, `expoFonts()` and `inject(Fonts)` check for `expo-font`'s native module before evaluating its JavaScript. Where the native module is not in the build, as in an Expo Go without it, the JavaScript is never evaluated, so Metro no longer reports its load failure as fatal before the `MissingModuleError`.
