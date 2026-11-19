---
__default__: patch
---

On macOS the gesture handler no longer logs "Failed to install UI runtime bindings. Please report this", and `<split-view>` and `<sidebar-item>` no longer make the host log that `NgNativeSplitViews` is missing: neither was a fault, and gestures and sidebars work as before.
