---
__default__: patch
---

On macOS, `<text>` in a right-to-left layout is aligned as on iOS, and the trackpad's back and forward swipes turn round when the app lays out right to left.

In a right-to-left layout, `<text>` with no alignment, `auto` or `start` aligns to the right whatever its script, `end` aligns to the left, and `left` and `right` swap, where text used to align by its own script and keep `left` and `right` as they are. In a left-to-right layout an alignment of `auto` or `start` that is set aligns to the left, as on iOS. A text input's text and placeholder are unchanged. When `I18nManager.isRTL` is true, a two-finger or three-finger swipe to the left goes back and one to the right goes forward, as Safari's do, and the screen in front of a native stack follows the fingers to the left during an interactive back swipe.
