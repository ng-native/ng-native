---
__default__: patch
---

On Linux with GTK 4.12 or later, a window at a fractional scale (1.25 or 1.5 on a Wayland desktop) lays out and reports at that scale: `Dimensions`, `PixelRatio` and the pixel rounding of layout take it, where they took the whole number GTK rounds it up to, and they follow a change of scale, as an Image's choice of source does. Below GTK 4.12 the scale stays a whole number.
