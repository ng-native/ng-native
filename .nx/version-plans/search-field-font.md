---
'__default__': patch
---

`<search-field>` draws its text in the `font-family`, `font-size`, `font-weight` and `font-style` its CSS resolves to, on iOS and Android, so a field in an app with its own `@font-face` type matches the text around it.

The font comes from a class on the field, its own style, or what it inherits. A face the app declares is matched by weight and style, as a `<text>`'s is, and the system font or a family no `@font-face` declares is drawn at that weight and slant. The size scales with the system text size setting. A field whose CSS sets none of them keeps the system font at its own size, as before; one inside a page that sets a font now takes it. On iOS a field in the system font larger than about 21px is taller than its 56-point default height, and needs a height to match.
