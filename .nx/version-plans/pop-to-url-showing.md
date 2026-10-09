---
'__default__': patch
---

`NativeNavigation.popTo()` pops to an earlier screen whose url is the one already showing, where a stack holds the same url twice: its promise never settled and nothing was popped.
