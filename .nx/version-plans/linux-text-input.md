---
__default__: patch
---

On the GTK desktop host on Linux, a `<text-input>` with `multiline` wraps its text over many lines, scrolls, takes Return as a new line, keeps to `maxLength` in UTF-16 units and shows its placeholder in `placeholderTextColor`, and every text input takes a new `selection`, as on macOS. While an input method composes, a controlled value and `setTextAndSelection`'s text wait for it to finish, on Linux as on macOS.
