---
__default__: patch
---

`FontRegistry.loadSheet()` warns in development when it is given a `null` sheet, as `loadFonts()` does.

The warning is said once per process, whichever of the two receives the `null`, and its wording names both. A `null` sheet is what `styleSheetOf()` returns for a class with no compiled sheet.
