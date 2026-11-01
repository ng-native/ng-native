---
__default__: patch
---

A `<keyboard-avoiding-view behavior="height">` laid out for the first time while the keyboard is already up keeps the height it shrinks to. It took the height it had shrunk to as its own, so on the next layout it measured no overlap and grew back under the keyboard.
