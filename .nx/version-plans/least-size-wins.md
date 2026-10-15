---
'__default__': patch
---

A `min-height` or `min-width` over a `max-height` or `max-width` wins, as in a browser, and so do a box's padding and border over a `max-height` or `max-width` under them. React Native held the box, and the box around it, to the maximum.
