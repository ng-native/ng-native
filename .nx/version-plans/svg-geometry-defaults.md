---
__default__: patch
---

An icon whose `<rect>`, `<circle>`, `<ellipse>` or `<line>` leaves out a position or size, such as a `<rect>` with no `y`, now draws it at 0 as SVG does, where it crashed the app on Android.
