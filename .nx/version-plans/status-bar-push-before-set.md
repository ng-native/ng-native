---
__default__: patch
---

A `StatusBar` claim pushed before the app's first `set()` stays on top. `set()` used to replace
whatever was first on the stack, so a screen that pushed before startup code set the base lost its
style, and dropping it later restored nothing.
