---
__default__: patch
---

On macOS `Fonts` and `loadFonts()` answer from the desktop host's `NgNativeFont`, which registers each font file with CTFontManager for the app's process: a font in the app, or one the dev server serves, downloaded first. Text that asks for the name a font was loaded under is set in that font's family, with the weight picked among the faces loaded in it.
