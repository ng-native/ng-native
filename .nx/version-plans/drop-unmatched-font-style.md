---
__default__: patch
---

An italic or oblique `font-style` that no declared `@font-face` of the family covers is no longer sent to native once a face is matched. Both platforms draw the upright face, rather than Android dropping the custom font for its system font in italic.
