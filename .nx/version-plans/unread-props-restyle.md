---
'__default__': patch
---

A prop no selector names no longer has its element, and everything in it, matched against the stylesheets again.

Any prop can be what a selector asks about, so one changing restyled the element and its subtree: a progress bar's `aria-valuenow` on every tick, a field's text on every key. Only the attributes a loaded stylesheet's selectors mention, and the id, do so now.
