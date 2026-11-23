---
__default__: patch
---

`HostEngine.colour(node)` reads the colour a node draws `currentColor` in, as its last commit settled it, and `HostEngine.watchColour(node, listener)` hears it change after each commit, as `token` and `watchToken` read a custom property.

Before a node's first commit, `colour` answers with the colour its own style gives it, or else its nearest committed ancestor's, since only a commit settles a node. A node left out of the cascade answers with the colour of the drawing it is in.
