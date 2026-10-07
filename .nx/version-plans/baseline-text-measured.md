---
'__default__': patch
---

A debug build no longer stops with "Attempt to mutate a sealed object" when a row with `align-items: baseline` is laid out again and one of its boxes holds text.

The text a baseline row takes a baseline from, where it is inside one of the row's boxes, is now measured again in every commit that commits the row again. Release builds were not affected: the assertion is compiled into debug builds only.
