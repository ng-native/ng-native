---
__default__: patch
---

On macOS `<expo-symbol>` draws its SF Symbol with AppKit in the desktop host, with its type, tint, palette, weight, scale and `resizeMode`, and its view takes the symbol image's size at its point size through the host's `NgNativeSymbol`, as on iOS. Its `animationSpec` plays nothing on macOS.
