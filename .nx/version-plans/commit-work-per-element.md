---
__default__: patch
---

The engine does less work per element as it commits and restyles: a style set is no longer copied to look for a transition, a node's own style is read without a copy where no rule on it is `!important`, and a node keeps the shape it is made with.
