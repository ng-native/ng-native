---
'__default__': patch
---

`scale3d()`, `translate3d()` and `translateZ(0)` are read as the flat transform they are on a view, in a stylesheet and on an element, where each was dropped with a warning. A move along z that is not zero is still refused, and says a native view is flat.
