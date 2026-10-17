---
__default__: patch
---

On iOS, a `<ui-picker>` with no `label` is drawn, where it drew nothing.

SwiftUI's picker view in `@expo/ui` draws nothing without a label, so `UiPicker` now sends an empty one when `label` is not set. A segmented picker never shows its label anyway.
