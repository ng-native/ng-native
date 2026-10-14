---
'__default__': patch
---

Text in a CSS system colour shows on Android. `CanvasText`, `FieldText`, `ButtonText` and `GrayText` (and the deprecated names for them) drew nothing there: they now take Android's `colorForeground`. `GrayText` is the text colour on Android, which has no grey of its own that follows light and dark.
