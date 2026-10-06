---
'__default__': patch
---

An element whose exit animation ends is no longer seen back at rest for a frame before its `animationend` listener removes it.

An animation with no `forwards` fill ended by committing the element's resting style, and its `animationend` was delivered after that commit, so an overlay that fades out and is removed on `animationend` flashed fully opaque for one frame. An ended animation that something listens to now keeps its last frame for that commit, and the element goes back to rest once the listener has run and left it in the tree. With no listener it is back at rest at once, as before.
