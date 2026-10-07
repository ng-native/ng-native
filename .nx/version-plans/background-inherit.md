---
'__default__': patch
---

`background: inherit` is now the parent's background colour, where it was dropped with a warning.

`background-color: inherit` already was; the shorthand is taken the same way, for the colour, which is the part of a background a view has a value of to hand on. A box that relied on `background: inherit` doing nothing now takes its parent's colour.
