---
__default__: patch
---

`userEvent.press`, `userEvent.longPress` and `fireEvent.press` on a `<ui-toggle>` flip it, as a tap does on iOS, Android and macOS, where before they did nothing.

On iOS and macOS the press ends with SwiftUI's `isOnChange`, the opposite of the bound `isOn`, or with none bound, of what the last press switched it to; one SwiftUI's `disabled` modifier turns off sends none. On Android it ends with Compose's `checkedChange`, the opposite of the value the switch shows. Either way `(isOnChange)` runs.
