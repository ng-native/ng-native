---
'__default__': patch
---

A declaration a stylesheet marks `!important` now stands over the same property in an element's inline style, as it does in a browser.

Before, an inline style won over every rule, so `.measuring { height: auto !important }` did nothing on an element with a `[style.height]` binding. An element that relied on its inline style beating an `!important` rule now takes the rule's value: drop the `!important`, or mark the inline value's rule the same way.
