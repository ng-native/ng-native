---
__default__: patch
---

A box asked `:has()` again for a change beneath it, a child added or a class changed on one, keeps what is under it matched as it was, where everything under the box was matched again.

The elements a rule asking `:has()` of the box is for are still matched again on their own. Opening a dialog under the root, with a class on the root changing in the same commit, no longer matches every element of the screen again.
