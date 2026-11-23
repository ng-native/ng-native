---
__default__: patch
---

`HostEngine.colour(node)` reads the colour a node draws `currentColor` in, as its last commit settled it, and `HostEngine.watchColour(node, listener)` hears it change after each commit, as `token` and `watchToken` read a custom property, on a host that keeps a cascade, as the engine does; a host without one answers undefined and never calls the listener.

A colour a component sets over the style, as an animation does, comes first. Before a node's first commit, since only a commit settles a node, `colour` answers from the node and then each ancestor in turn: the colour a committed one settled, or the colour in the own style of one not yet committed. A node left out of the cascade answers with the colour of the drawing it is in.
