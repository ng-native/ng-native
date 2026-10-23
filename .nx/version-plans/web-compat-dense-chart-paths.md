---
__default__: patch
---

A chart's line series drawn as a `<path>` of thousands of points no longer stalls iOS for seconds on each drawing: it is drawn thinned to the lowest and highest point of each point-wide column, while `getAttribute('d')` and `getBBox` still read the whole path.
