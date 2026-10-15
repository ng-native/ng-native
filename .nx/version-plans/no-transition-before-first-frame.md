---
'__default__': patch
---

A class added to a view before a frame has drawn it no longer starts a transition, as in a browser: Spartan's sheet, committed once before its directive's `effect` adds `bg-popover`, appeared with a 200ms fade from transparent, and now appears at once. A change made once the view has been drawn eases as before.
