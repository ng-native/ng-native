---
__default__: patch
---

`userEvent.press`, `userEvent.longPress` and `fireEvent.press` on a `<switch>` flip it, as a tap does on iOS, Android and macOS, where before they did nothing.

The press ends with the `change` event the native switch sends, with the opposite of the value last committed, so `(checkedChange)`, `[(checked)]` and a form field see the new value. A disabled switch sends none. `fireEvent(node, 'change', { value })` sets a given value.
