---
__default__: patch
---

A numeric `flex` set in an element's inline style or bound on it now wins over a stylesheet's `flex-grow`, `flex-shrink` or `flex-basis`, so `[style.flex]="1"` grows under a class such as Tailwind's `grow-0`.

Yoga reads each of those longhands over `flex`, so before, the class's value was kept. Each covered longhand now takes the value Yoga gives `flex` alone: for `flex: 1`, a grow of 1, a shrink of 0 and a basis of 0, which is React Native's `flex: 1` and not CSS's (CSS shrinks it as well). A longhand the element sets itself, or that the stylesheet marks `!important`, still wins, and a `flex` that is not a finite number covers nothing.
