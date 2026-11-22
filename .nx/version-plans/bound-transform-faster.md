---
__default__: patch
---

A transform bound as a string, `[style.transform]="'translate(' + x + 'px, ' + y + 'px)'"`, is read in about half the time it was, and every bound style with a bracket in it is checked for brackets left open faster, which a frame of an animation driven from JavaScript does for every view it moves. A number in a bound transform with a sign, an exponent or its unit in capitals, such as `translateX(+4PX)` or `scale(1e-1)`, is now the number a stylesheet's transform gives; before, it reached native as text, which native does not read.
