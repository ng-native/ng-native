---
'__default__': patch
---

A property named in `transition` with a time of 0ms is eased when one change gives it both a new value and a time, as `.grown { transform: scale(1); transition-duration: 100ms }` does. It went straight to the new value, because nothing remembered where the property was while its time was zero.
