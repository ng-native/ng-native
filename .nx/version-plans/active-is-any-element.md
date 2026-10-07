---
'__default__': patch
---

A press no longer restyles the whole screen under a stylesheet that uses Tailwind's `group-active:` or `peer-active:`.

Tailwind writes those as `:is(.group):active .label`, where the element asked about is named inside `:is()`. The engine read a compound with no class of its own as one any element could be, so every element from the pressed one up to the root was restyled with all under it, on touch down and again on release. It now reads the classes inside `:is()` too, and restyles the group alone.
