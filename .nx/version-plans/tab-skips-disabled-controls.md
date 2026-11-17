---
__default__: patch
---

Tab and Shift-Tab on the macOS desktop host pass over a disabled native control (a button, switch, segmented control or date picker) instead of moving the focus onto it.

AppKit's `makeFirstResponder:` focuses a disabled control all the same, so the host now checks that the control is enabled before moving the focus there, and Tab goes on to the next view in order.
