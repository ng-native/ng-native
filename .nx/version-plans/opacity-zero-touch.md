---
'__default__': patch
---

A view that is pressed and has `opacity: 0` takes the press on iOS, as it does on Android and in a browser. iOS sends no touch to a view whose alpha is under a hundredth, so a see-through layer laid over the page to hear a press, such as the backdrop behind a menu, heard nothing and the press went to what was under it.
