---
__default__: patch
---

On the GTK desktop host on Linux, each window is an `AdwApplicationWindow` with its header bar in an `AdwToolbarView`, and `titleBar` takes effect: `'transparent'` runs the content under a flat header bar and `'hidden'` also hides the title. In those modes the safe area's top inset is the header bar's height, and `--safe-area-inset-titlebar-leading` and `--safe-area-inset-titlebar-trailing` are how far the window controls reach in from each side, as the desktop's `gtk-decoration-layout` places them. A cover stays below the header bar.
