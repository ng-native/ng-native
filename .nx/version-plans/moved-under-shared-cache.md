---
'__default__': patch
---

An element moved from one box to another, or under a box whose class changed, is styled by what is over it now, where neither box has a rule or a value to hand down.

Boxes with nothing to style share one cache once they are resolved a second time, after the window is resized or the colour scheme changes, in an app with no global stylesheet and no safe-area tokens. An element moved between two of them kept the style it had, though a rule of its component asks about a class only one of them has, `.dark .label`. A class added to one of them was missed in the same way when a rule reads it through `:not()`, where another such box was resolved first in the commit. Both are styled again now.
