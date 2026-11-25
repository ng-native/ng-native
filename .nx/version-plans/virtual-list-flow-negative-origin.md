---
__default__: patch
---

On a `<virtual-list>` whose rows size themselves, with a negative `rowGap` that overlaps rows above the window more than their heights, the pinned rows rendered ahead of the window could come to more than every row before it. The space above them cannot be less than nothing, so they and the rows after them were drawn that much too low. The first row rendered now takes the difference as a negative margin, and each row is at its own place.
