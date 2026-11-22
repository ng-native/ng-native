---
__default__: patch
---

A transform bound as a string is read in about half the time it was, and a number in one with a sign, an exponent or its unit in capitals is now read as a number.

`[style.transform]="'translate(' + x + 'px, ' + y + 'px)'"` is read again every frame of an animation driven from JavaScript, and every bound style with a bracket in it is checked faster for brackets left open. `translateX(+4PX)` or `scale(1e-1)` is now the number a stylesheet's transform gives; before, it reached native as text, which native does not read.
