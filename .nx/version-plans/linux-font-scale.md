---
__default__: patch
---

On the GTK desktop host on Linux, text follows the desktop's text scaling (GTK's `gtk-xft-dpi`, which GNOME's Large Text and text scaling factor set): `fontScale` in `Dimensions`, `PixelRatio.getFontScale()` and `Accessibility` report it. A change while the app runs updates `Dimensions` and `PixelRatio.getFontScale()` and lays the text on screen out again at the new size, and `watchConditions` keeps the text of later commits at it; `Accessibility.fontScale` keeps the value read at launch. macOS keeps a `fontScale` of 1.
