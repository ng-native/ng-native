---
__default__: patch
---

With `provideWebCompat()`, the window has an in-memory `localStorage` and `sessionStorage`, `getSelection()` (on the window and the document) with nothing selected, an `open()` that returns `null` and a `ShadowRoot`, so a library that reads them while it loads no longer throws; an app that did not ask for the package gets none of them.
