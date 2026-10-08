---
'__default__': patch
---

A `@keyframes` value can be a `var()`, an `em` or a viewport unit: it is settled against the element that plays the frame, as in a browser, where it was a build error (or a dropped declaration) before, so `to { height: var(--panel-height) }` opens each panel to the height set on it.
