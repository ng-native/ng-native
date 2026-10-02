---
__default__: patch
---

A property CSS inherits, such as a colour or font size set with `[style.color]` or `[style.fontSize]`, now reaches the text inside the element, and `color: inherit` and `currentColor` read it there and on the element itself, as they would one set by a rule.

An `!important` rule still beats it, as in a browser. A `[style]` change restyles nothing below it, as before, when neither the old nor the new style sets an inherited property.
