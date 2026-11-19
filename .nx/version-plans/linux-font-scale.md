---
__default__: patch
---

On the GTK desktop host on Linux, text follows the desktop's text scaling (GTK's `gtk-xft-dpi`, which GNOME's Large Text and text scaling factor set): `fontScale` in `Dimensions`, `PixelRatio.getFontScale()` and `Accessibility` report it, and a change while the app runs is passed on to the app's windows as React Native's iOS host passes on a Dynamic Type change. macOS keeps a `fontScale` of 1.

On Linux, `Accessibility.fontScale` follows that change while the app runs, where on iOS and Android it is re-read when the app comes back to the foreground.
