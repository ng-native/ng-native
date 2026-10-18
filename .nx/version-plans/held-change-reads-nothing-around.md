---
__default__: patch
---

A commit whose changes are all inside boxes out of the flow with a width and a height of their own, such as a progress bar's indicator in a track of a set size, reads back no fitted box or shared row outside them. A progress bar ticking on a timer no longer has the whole page's layout read back from native on each tick.
