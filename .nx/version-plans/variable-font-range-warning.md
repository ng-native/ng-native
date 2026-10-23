---
'__default__': patch
---

The build now warns about an `@font-face` that declares a weight range, such as `font-weight: 200 800`, because neither platform picks a variable font's instance by the text's `font-weight`. iOS draws the font's default instance at every weight, and Android draws it below 700 and its system font from 700. The Fonts page now says to declare one file per weight instead. The face is still registered as before.
