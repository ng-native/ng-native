---
__default__: patch
---

A desktop host built from source builds in one directory at a time: a second `ng-native-desktop` command that builds the same host waits for the first, printing that it is waiting, instead of building beside it and leaving its build log corrupt, which made the next build recompile hundreds of objects with nothing changed.
