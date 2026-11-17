---
__default__: patch
---

On macOS, VoiceOver's name for a `<modal>` sheet, cover or popover now follows its `accessibilityLabel` (or `aria-label`) when that changes or is removed while it is open, instead of keeping the label it opened with.
