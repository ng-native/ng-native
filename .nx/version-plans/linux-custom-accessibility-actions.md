---
__default__: patch
---

On Linux a view's `accessibilityActions` reach a screen reader over AT-SPI, listed beside its press as `custom.<name>` (GTK gives AT-SPI no label for an action), and invoking one sends `onAccessibilityAction` to a view that listens, as on macOS.
