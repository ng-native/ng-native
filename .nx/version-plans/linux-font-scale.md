---
__default__: patch
---

On the GTK desktop host on Linux, text follows the desktop's text scaling (GTK's `gtk-xft-dpi`, which GNOME's Large Text and text scaling factor set): `fontScale` in `Dimensions`, `PixelRatio.getFontScale()` and `Accessibility` report it. A change while the app runs updates `Dimensions` and `PixelRatio.getFontScale()` and lays the text on screen out again at the new size, and `watchConditions` keeps the text of later commits at it. macOS keeps a `fontScale` of 1.

On Linux, `Accessibility.fontScale` follows that change while the app runs, where on iOS and Android it is re-read when the app comes back to the foreground.
