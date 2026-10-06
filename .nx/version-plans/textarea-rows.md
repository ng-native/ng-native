---
'__default__': patch
---

`rows` on a multiline `<text-input>` sizes it: that many lines of its line height, with its padding and border.

A multiline field with `rows="3"` and nothing typed was one line tall, because native sizes a field by its text. A multiline field with `rows`, a `line-height` and no height of its own is now given that height, as a browser sizes a `<textarea>`. A height written for the field still wins.
