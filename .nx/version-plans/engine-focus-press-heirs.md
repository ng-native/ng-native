---
'__default__': patch
---

A node that leaves the tree focused or pressed is not styled that way when it comes back, and leaves nothing pressed behind it. A field removed with the keyboard up came back matching `:focus`, and a card whose pressed button was removed mid-press stayed `:active` until the next press. A child with `inherit` follows a parent's bound `[style.x]` when it changes too, where it kept the first value.
