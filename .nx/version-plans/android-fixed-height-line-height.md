---
__default__: patch
---

On Android, a single-line `<text-input>` with a line height and a fixed `height` centres its text, where it sat about 1.7pt high in a 44pt field.

Where a `height` sizes a single-line field, it now commits no `lineHeight` on Android, as on iOS: the height already says how tall the field is, and `EditText` centres the font's own line box exactly. A field without a `height` keeps its `lineHeight`, which sizes it, and a multiline field is unchanged.
