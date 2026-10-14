---
'__default__': patch
---

A media query list with a type a device is not, `@media screen and (min-width: 500px), print`, keeps its other queries. The whole rule was dropped with a warning, where only the `print` query never matches.
