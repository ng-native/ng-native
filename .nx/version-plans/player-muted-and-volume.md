---
'__default__': patch
---

A video player's `state()` starts with the player's own `muted` and `volume`, and keeps them when its source changes. It read unmuted at full volume until an event said otherwise, and again after every new source.
