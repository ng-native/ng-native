---
__default__: patch
---

On macOS, a presented `<modal>` no longer commits its size again and again while it stays open, which kept one CPU core busy.

The modal's state update with the size it had just sent sent that size once more, so each commit started the next. A modal still sends its size when it opens, when its window resizes, and when its state holds a different one.
