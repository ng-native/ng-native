---
__default__: patch
---

A sticky row of a `<virtual-list>` whose range changes in the moment before a scroll pauses, as when a row further down turns sticky as the list stops, is now drawn at its new range once the list is at rest. Native was told where the list is only for a change made at rest, so with no scroll event to come the row kept its old range until the next scroll.
