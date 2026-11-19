---
__default__: patch
---

On iOS, where native moves sticky rows, a jump with `scrollToIndex` past a sticky row now pins the row it lands under at once, rather than at the next scroll, and leaves no gap where a plain row took the slot of a sticky one: a sticky row's slot now goes only to another sticky row.
