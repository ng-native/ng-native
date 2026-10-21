---
'__default__': patch
---

A dashed or dotted border the same on every side is drawn dashed or dotted on Android when it has rounded corners, where it was drawn solid.

Once the cascade and every token have settled a view's border, the engine sends React Native's unsided `borderWidth` and `borderColor` beside the four sides wherever the four agree and the width is not 0: Android strokes a rounded border from those alone. This holds for a width or colour from a `var()`, in `em` or a viewport unit, or given side by side. A border whose sides differ, or that has a logical side of its own, is sent as its sides only, as before.
