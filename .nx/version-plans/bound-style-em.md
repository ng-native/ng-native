---
'__default__': patch
---

A bound style in `em`, `rem` or a viewport unit (`vw`, `vh`, `vmin`, `vmax`) is now measured as the same value in a stylesheet is. `[style.width]="'2em'"` is measured against the font size in scope and follows it when it changes, `'2rem'` is 32 points, and `'50vw'` follows the viewport. A bound `line-height` in `em` gives a line height in points, as a stylesheet's does. Each used to reach native as text, which native drops. So `<ng-icon size="2em" />` is now twice the font size around it, where it was drawn at `1em`.
