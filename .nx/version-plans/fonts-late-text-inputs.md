---
__default__: patch
---

A text input whose `@font-face` registers after it was laid out switches to that face, in its value and its placeholder, instead of keeping the system font.

A text input takes its font a different way from a paragraph. iOS sets the font on the field again only when the input's text attributes change, and Android only when `fontFamily` is in the props the input is sent. Each text input that names a newly registered family is now committed with its `maxFontSizeMultiplier` moved by the same step as a paragraph's, and with its `fontFamily` sent again once. It keeps its view, so its focus, its typed text and its cursor position stay where they were.
