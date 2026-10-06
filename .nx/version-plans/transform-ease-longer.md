---
'__default__': patch
---

A transform is eased into a longer or shorter list of functions that starts the same way.

`transform: translateY(4px)` to `translateY(8px) scale(0.5)` jumped to its end state, because lists of different lengths were not interpolated. The shorter list is now padded with the longer one's functions at rest, as CSS has it, so the functions gained ease in from their identity and the ones lost ease out toward it. Lists that start with different functions still step.
