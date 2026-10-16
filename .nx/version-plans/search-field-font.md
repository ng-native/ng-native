---
'__default__': patch
---

`<search-field>` draws its text in the `font-family` and `font-size` its CSS resolves to, on iOS and Android, so a field in an app with its own `@font-face` type matches the text around it.

The family comes from a class on the field, its own style, or what it inherits, and a face the app declares is matched by `font-weight` and `font-style`, as a `<text>`'s is. The size scales with the system text size setting. A field whose CSS names neither keeps the system font at its own size, as before; one inside a page that sets a font now takes it.
