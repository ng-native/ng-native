---
'__default__': patch
---

`transition: all` now eases an `opacity` or a `background-color` that no rule sets from or to its initial value, as a transition that names the property does. `view { transition: all 200ms }` with `.closed { opacity: 0 }` fades out and back, where it jumped.
