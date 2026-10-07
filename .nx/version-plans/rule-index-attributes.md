---
'__default__': patch
---

A rule that names its element by an attribute alone, or as anything inside an element with a class, is no longer tried against every element.

`[data-open] { }` and `.item:focus * { }` say nothing of the element's own name or class, so each was offered to every element of the screen, and the second walked to the root each time to find no `.item`. They are filed under the attribute and under the class, and offered to the elements that have the one or sit inside the other.
