---
__default__: patch
---

A `shortcut` on `F13` to `F20` now fires from a key press on macOS, Linux and, with a modifier as every Android shortcut needs, Android 16 and later, where before only a macOS menu item could use those keys.

The macOS and Linux hosts now name those keys in their key events, and the Linux menu bar shows them as accelerators. On Android, `F13` to `F20` have key codes from Android 16 (API 36), where the Keyboard Shortcuts helper lists them by key code; an older Android's helper leaves them out. iOS still stops at `F12`, as UIKit names no key past it.
