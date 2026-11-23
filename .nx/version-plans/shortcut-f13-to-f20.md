---
__default__: patch
---

A `shortcut` on `F13` to `F20` now fires from a key press on macOS, Linux and Android 16 and later, where before only a macOS menu item could use those keys.

The macOS and Linux hosts now name those keys in their key events, and the Linux menu bar shows them as accelerators. On Android, `F13` to `F20` have key codes from Android 16 (API 36), and the Keyboard Shortcuts helper gets the key code for them. iOS still stops at `F12`, as UIKit names no key past it.
