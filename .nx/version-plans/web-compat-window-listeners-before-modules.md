---
__default__: patch
---

A library that adds a window listener as its modules load, as Angular's CDK does, no longer throws where it is imported outside a lazy route: `withWebCompat` gives the window stand-in listeners before any module runs, and hands what they were given to the window once an app is up.
