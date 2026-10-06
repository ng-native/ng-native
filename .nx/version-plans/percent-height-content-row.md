---
'__default__': patch
---

`height: 100%` under a parent stretched across a row that is as tall as its content is no height, where it was the height of the screen.

A box stretched across a row counted as having a height a percentage could be taken of, whether or not the row had one. Under a row sized by its content, Yoga then took the percentage of the space on offer: the screen, or everything a scroll view holds. The percentage is now kept only where the row has a height of its own, and the box is otherwise as tall as what it holds, as in a browser.
