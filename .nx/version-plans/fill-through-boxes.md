---
'__default__': patch
---

A `fill` or `stroke` a stylesheet sets on an element around a library's drawing reaches the drawing's shapes, as a browser hands it down through every element, so Material's calendar arrows, inside an icon button with `fill: currentColor`, draw in the button's colour instead of black. An icon's shapes from `@ng-native/icons` take no paint this way, as before.

A paint attribute on the `<svg>` itself still wins over one handed down from a box around it, as in a browser: `<svg fill="none" stroke="currentColor">` inside Material's icon button draws an outline, not a filled shape.
