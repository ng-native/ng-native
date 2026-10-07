---
'__default__': patch
---

A press on an element named as one alternative of `:is()` restyles what a rule styles inside it again.

`:is(.group, .card):active .label` lost its pressed style on a `.group` after the last release: only the last alternative was read as the element pressed. Every alternative is.
