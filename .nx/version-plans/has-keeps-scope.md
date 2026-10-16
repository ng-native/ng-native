---
__default__: patch
---

A change beneath a box, such as a child added or a class changed on one, checks the box's `:has()` rules again without matching everything else under the box again.

The elements a rule asking `:has()` of the box is for are still matched again on their own. Opening a dialog under the root, with a class on the root changing in the same commit, no longer matches every element of the screen again.
