---
'__default__': patch
---

A focused field that a rule hides, `.field:focus { display: none }` or a box it is in, is shown again once hiding it has taken its focus away. It stayed hidden and unfocused, because the blur came in the middle of the commit that hid it.
