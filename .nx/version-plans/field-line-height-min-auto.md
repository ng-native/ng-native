---
'__default__': patch
---

A single-line text field whose `min-height` is `auto` now has its text centred by its line height on iOS, as a field with no `min-height` has.

The centring was skipped for any `min-height` that was not a number, `auto` included, which left the text 3 to 5 points low in the field. `auto` is no minimum of the field's own.
