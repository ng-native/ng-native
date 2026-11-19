---
__default__: patch
---

The macOS desktop host draws a view's `filter` (every function but `drop-shadow()`, applied in order over the view and its children) and `mix-blend-mode`, which it drew as nothing, so the macOS build keeps those filter functions where it dropped all but `brightness()` and `opacity()` with a warning.

A `drop-shadow()` in a macOS build, or in a rule that can apply on macOS, is still dropped with a warning, now naming macOS: use `box-shadow`, or scope the rule to iOS or Android with a `.platform-ios` or `.platform-android` ancestor.
