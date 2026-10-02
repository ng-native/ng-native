---
__default__: patch
---

An element that names `@keyframes` from a component sheet first met later in the same commit, such as a sibling's, now plays them from the first render, and the development warning that they are missing no longer fires for keyframes that arrive within the commit.
