---
__default__: patch
---

The GTK desktop host on Linux draws linear and radial gradients (`background-image`) with their size, position and repeat, and dashed and dotted borders, which it drew as nothing and as solid lines before. It also applies `filter` (each function in order, `blur` and `drop-shadow` included, which a Linux build and a `linux:` rule now keep where they dropped all but `brightness()` and `opacity()` with a warning), `mix-blend-mode` (every mode but `plus-lighter`, blending a view with its parent's painting and the siblings under it), and an `<image>`'s `tintColor`. The macOS host does not apply `filter`, `mix-blend-mode` or an image's `tintColor` yet.
