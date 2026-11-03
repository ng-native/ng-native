---
__default__: patch
---

A `null` bound to `[width]` on `<native-toolbar-item>`, or to `[titleFontSize]`, `[largeTitleFontSize]` or `[backTitleFontSize]` on `<native-header>`, is now unset as `undefined` is, where it sent native `NaN`.
