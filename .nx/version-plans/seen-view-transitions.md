---
'__default__': patch
---

A view whose `bornIn` was cleared, which is how a caller says it has been seen as it is, keeps its transitions: the check that drops the transitions of a view nobody has seen yet took a cleared `bornIn` for an unseen one and dropped them on every commit.
