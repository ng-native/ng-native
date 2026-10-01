---
__default__: patch
---

The typed `@expo/ui` components draw the same on iOS and Android where a template leaves something unset, and `$event.stopPropagation()` works in a toggle's `(isOnChange)` on Android.

A `ui-toggle` without `isOn` now switches itself on Android, as it does on iOS, and a `ui-vstack` or `ui-hstack` without an `alignment` is centred on both. A slider's `steps` is rounded to a whole number on both, and divides the range SwiftUI actually draws, which is 0 to 1 unless both `min` and `max` are set.
