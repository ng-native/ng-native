---
'__default__': patch
---

`@media (prefers-reduced-motion)` with no value is read as `(prefers-reduced-motion: reduce)`.

The rule was dropped with a warning that named `prefers-reduced-motion` as a feature a device cannot answer, in a list of the ones it can. A media feature with no value is true for any value but its "none", which for the motion asked for is `reduce`. `prefers-color-scheme` and `orientation` with no value are still refused, and the warning now says it is the missing value that is not read.
