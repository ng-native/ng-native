---
__default__: patch
---

A token worked out on the device, such as a `calc()` of tokens bound on an element, and a transform bound as a string now treat only CSS whitespace as whitespace, so a no-break space leaves the value invalid as it does in Chrome, and an inline transform CSS cannot read leaves the transform a rule sets rather than replacing it.

A bound transform with anything but functions and their numeric arguments in it, such as `rotate(90deg) junk`, is now dropped in favour of the rule's transform, or none, where it was applied in part.
