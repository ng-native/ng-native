---
__default__: patch
---

`StatusBar.set()` and `push()` no longer subscribe the caller to the bar's own state. An app that set its base style in an `effect` had that effect run again on every later `set()` or `push()`, which wrote the base back over what was just set.
