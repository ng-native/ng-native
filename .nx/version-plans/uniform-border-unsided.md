---
'__default__': patch
---

A dashed or dotted border the same on every side is drawn dashed or dotted on Android when it has rounded corners. It was drawn solid there. `border`, `border-width` and `border-color` now write React Native's unsided `borderWidth` and `borderColor` beside the four sides when the four sides agree, which Android strokes a rounded border from. A width or colour given as a `var()` still writes the sides only.
