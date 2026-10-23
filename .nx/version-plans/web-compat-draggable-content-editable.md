---
__default__: patch
---

With `provideWebCompat()`, HTML elements have `draggable` (read and written as the attribute, true by default for an image and a link with an href) and a read-only `isContentEditable`, and `:read-write` treats a `contenteditable` value that is no keyword as inherited, as a browser does.
