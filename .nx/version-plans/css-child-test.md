---
__default__: patch
---

Tailwind's `*:` variant styles the children of the element it is on, as `**:` already does for everything beneath it: `*:rounded-full`, `*:data-[slot=icon]:size-4`. It compiles to `:is(<compound> > *)`, which is now read as a test of the node's parent, where the rule was dropped with a warning.
