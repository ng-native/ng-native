---
__default__: patch
---

On Android, `ui-date-picker`'s `range` now limits the dates that can be picked, and its `accessibilityLabel` is what TalkBack reads, with `@expo/ui` 57.0.21 or later.

Compose's date picker reads the range as `selectableDates`, in milliseconds, and the label as the `semantics` modifier's `contentDescription`, so a picker's committed `modifiers` on Android now include it. The typed components also stop sending Compose the SwiftUI props it never reads: an image's and a menu's props and added modifiers, a button's `label`, `systemImage` and `role` (the label is still drawn as text inside it), a toggle's `label`, a date picker's `title`, a host's `ignoreSafeArea` and a slot's `extraProps`.
