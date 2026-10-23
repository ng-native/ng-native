---
'__default__': patch
---

Under `provideWebCompat()`, `element.style.filter`, a `filter` in a `style` attribute and a `[style.filter]` binding now take filter functions, such as `brightness(1.2) blur(2px)`, and give the view the filter list a stylesheet's `filter` compiles to, where every filter function was refused before.

`blur()` takes a length in `px` or `rem`, `hue-rotate()` an angle, `drop-shadow()` two or three lengths and a colour, and the other functions a number or a percentage. A filter with a `url()` or any other value native has no form of is no filter, as in a browser. React Native draws `brightness()` and `opacity()` on iOS and Android, and the other functions on Android only.
