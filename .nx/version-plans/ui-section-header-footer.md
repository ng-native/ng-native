---
__default__: patch
---

A `<ui-slot name="header">` or `<ui-slot name="footer">` in a `ui-section` is now the section's header or footer on iOS, where it was drawn as one of its rows.

`@expo/ui`'s `SectionView` reads them as slots of its own beside its `content`, and `ui-section` put everything it held inside `content`. A header slot lets a section's heading be any view, with its own font, where `title` is plain text. A `title` still wins when both are set: `@expo/ui`'s `SectionView` draws a non-empty `title` and drops the header slot, and an empty `title=""` counts as unset.
