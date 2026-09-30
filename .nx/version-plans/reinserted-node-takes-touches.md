---
__default__: patch
---

A node taken out of the tree and put back under the same parent after a commit takes touches, rather than ignoring every one.

A node that is out of the tree when a commit runs forgets its committed native views, so it is created afresh when it comes back, as React creates an element it mounts again. Its native state (a scroll offset, a text field's selection) goes with it. A node moved within one pass never leaves the tree and keeps its views.
