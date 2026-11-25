---
__default__: patch
---

A scroll drive or a native animation connected to a view whose transform or opacity the engine has set on native since a graph last let it go now lets the graph that set them go first. It used to let it go after, and React Native's C++ animated module, which keeps one graph a view, then forgot the new one too, so a commit could change the view under it.
